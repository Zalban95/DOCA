'use strict';

/**
 * Schedules (TODO H7.1; OpenDots' recurring instructions): a turn or a recipe started by itself, on an interval
 * or a cron expression, as the person it belongs to — their level, their approvals (asked on their devices) and
 * their conversation. One the agent makes starts `proposed` and runs only after a person switches it on: a
 * schedule makes the agent act unasked, again and again, and that is a person's decision (AGENTS.md, the
 * agent proposes). One a person makes in the panel starts on.
 *
 * A reminder (kind `reminder`, when {at}) is the exception, decided 2026-10-07: the person asked for it in their own words,
 * so it is on at once, fires once as a notice to that person's own devices, and is then `done`.
 *
 *   { id, title, kind: 'turn'|'recipe'|'reminder', message?, recipe?, values?, text?, device?, when: {every}|{cron}|{at},
 *     state: 'on'|'paused'|'proposed'|'done',
 *     by, sessionId, nextAt, lastAt, last: {ok, summary, at}, runs, createdAt, madeBy: 'person'|'agent' }
 */
const crypto = require('crypto');
const store = require('../store');
const when = require('./when');

const DOC = 'schedules';
const TICK_MS = 20000;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const rows = () => store.readJson(DOC, { schedules: [] }).schedules;
// Every change is heard on the live feed (topic `schedules`, the person it runs as): a reminder the agent just made
// showed in Harness → Schedules only after a reload (self-test round two, C2).
const save = (list, s) => { store.writeJson(DOC, { schedules: list }); if (s) require('../live').changed('schedules', s.id, 'changed', { by: s.by }); };
const get = id => rows().find(s => s.id === id) || null;
const patch = (id, fields) => { const list = rows().map(s => (s.id === id ? { ...s, ...fields } : s)); const s = list.find(x => x.id === id); save(list, s); return s; };

function normalize(input, by, madeBy) {
  if (input.kind === 'reminder') {
    const w = { at: new Date(input.at).toISOString() };
    if (!when.next(w)) throw bad(`${input.at} is not ahead: a reminder is for later.`);
    const text = String(input.text || '').trim().slice(0, 500);
    if (!text) throw bad('A reminder needs what to remind of.');
    return { title: text.slice(0, 100), kind: 'reminder', text, device: input.device ? String(input.device) : null, when: w, by, madeBy };
  }
  const kind = input.kind === 'recipe' ? 'recipe' : 'turn';
  const w = input.cron ? { cron: String(input.cron).trim() } : { every: Number(input.every) };
  when.next(w);   // refuses a bad interval or expression with a sentence
  if (kind === 'turn' && !String(input.message || '').trim()) throw bad('A scheduled turn needs the message it sends.');
  if (kind === 'recipe' && !require('../recipes/store').get(input.recipe)) throw bad(`No recipe "${input.recipe}".`, 404);
  const title = String(input.title || (kind === 'recipe' ? `Recipe ${input.recipe}` : input.message)).trim().slice(0, 100);
  return { title, kind, ...(kind === 'turn' ? { message: String(input.message).slice(0, 4000) } : { recipe: input.recipe, values: input.values || {} }),
    when: w, by, madeBy };
}

function create(input, { person, madeBy = 'person', sessionId = null } = {}) {
  if (!person?.id) throw bad('A schedule runs as somebody: sign in first.', 401);
  const s = { id: `sch_${crypto.randomBytes(5).toString('hex')}`, ...normalize(input, person.id, madeBy),
    state: madeBy === 'agent' && input.kind !== 'reminder' ? 'proposed' : 'on', sessionId: input.sessionId || sessionId || null,
    runs: 0, lastAt: null, last: null, createdAt: new Date().toISOString() };
  s.nextAt = when.next(s.when)?.toISOString() || null;
  save([...rows(), s], s);
  return s;
}

function setState(id, state) {
  const s = get(id);
  if (!s) throw bad('No such schedule.', 404);
  if (!['on', 'paused'].includes(state)) throw bad('state is on or paused');
  return patch(id, { state, ...(state === 'on' ? { nextAt: when.next(s.when)?.toISOString() || null } : {}) });
}

function remove(id) { const s = get(id); if (!s) throw bad('No such schedule.', 404); save(rows().filter(x => x.id !== id), s); return { removed: id }; }

/** Run one now: a turn into its conversation (a new one the first time), or a recipe; the outcome is kept on it. */
async function runNow(id) {
  const s = get(id);
  if (!s) throw bad('No such schedule.', 404);
  const person = require('../harness/turn/client').personById({ id: s.by, orgId: require('../auth/store').defaultOrg()?.id || null });
  if (!person) { patch(id, { state: 'paused', last: { ok: false, summary: 'Paused: the person it runs as is gone or suspended.', at: new Date().toISOString() } }); return get(id); }
  const client = { name: `Schedule · ${s.title}`, kind: 'schedule', user: person };
  patch(id, { lastAt: new Date().toISOString(), runs: (s.runs || 0) + 1 });
  require('../activity').note({ from: 'schedules', what: `ran "${s.title}" (${s.kind || 'turn'})`, why: 'its time came', person });
  let last;
  try {
    if (s.kind === 'reminder') {
      // Only this person's own devices that can show it (or the one named), and their pages on the panel: the record
      // names exactly who got it, or says nobody could and why (harness/reach-notice.js).
      const notice = require('../harness/reach-notice');
      const out = notice.deliver({ personId: person.id, title: 'Reminder', text: s.text, to: notice.ownIds(person.id, s.device), panel: 'always', from: 'reminder' });
      last = { ok: !!(out.sent?.delivered.length || out.onPanel), summary: out.summary };
      return patch(id, { state: 'done', nextAt: null, last: { ...last, at: new Date().toISOString() } });
    }
    if (s.kind === 'recipe') {
      const r = await require('../recipes/run').run(require('../recipes/store').get(s.recipe), { params: s.values, person, client });
      last = { ok: r.ok, summary: r.summary, sessionId: r.sessionId };
    } else {
      const memory = require('../harness/memory');
      let sessionId = s.sessionId && memory.getSession(s.sessionId) ? s.sessionId : null;
      if (!sessionId) {
        sessionId = memory.createSession(`Scheduled · ${s.title}`.slice(0, 120), { activate: false }).id;
        require('../harness/session-access').claim(person, sessionId);
        patch(id, { sessionId });
      }
      const out = await require('../harness/agent').send({ message: s.message, sessionId, client });
      last = out?.queued ? { ok: true, summary: 'The conversation was working: the message waits for its turn.', sessionId }
        : { ok: true, summary: String(out?.text || '').slice(0, 300), sessionId };
    }
  } catch (e) { last = { ok: false, summary: e.message.slice(0, 300) }; }
  return patch(id, { last: { ...last, at: new Date().toISOString() } });
}

const _inFlight = new Set();
/** Every tick: start what is due and on, once each, and set when it runs next. */
async function tick(now = new Date()) {
  const due = rows().filter(s => s.state === 'on' && s.nextAt && Date.parse(s.nextAt) <= now.getTime() && !_inFlight.has(s.id));
  for (const s of due) {
    patch(s.id, { nextAt: when.next(s.when, now)?.toISOString() || null });   // a slow run never makes it fire twice
    _inFlight.add(s.id);
    runNow(s.id).catch(() => {}).finally(() => _inFlight.delete(s.id));
  }
  return due.map(s => s.id);
}

let _timer = null;
function start() { if (_timer) return; _timer = setInterval(() => tick().catch(() => {}), TICK_MS); _timer.unref?.(); }

/** What a person sees: their own, or every one for a host. */
function listFor(person) {
  const host = require('../harness/session-access').isHost(person);
  return rows().filter(s => host || s.by === person?.id).map(s => ({ ...s, whenText: when.describe(s.when) }));
}

module.exports = { create, setState, remove, runNow, tick, start, listFor, get };

'use strict';

/**
 * A service's long job (a 3D model, a video, a song), followed by the hub rather than by the agent: once an action
 * with `x-doca-job` is submitted, the hub asks the service's poll action every `every` seconds — no model step is
 * spent waiting — and when the status says done it keeps the result file(s) as attachments, writes an activity line,
 * and tells the conversation that started it: an automatic turn when it is free (supervisor.wake), or a message read
 * before its next step when it is working (inbox.js) — so the agent shows the file with show_media. A job that ends
 * within the call's own short wait is answered in the call instead, and nobody is woken.
 *
 * The record is kept (store doc `api-service-jobs`, the last 50), the waiting is not: a restart cannot follow a job, so
 * `recover()` marks one that was running as interrupted and tells its conversation, with the service's job id —
 * `service call … follow` takes it up again, since the service usually finished it anyway.
 */
const crypto = require('crypto');
const docs = () => require('../db/docs');
const { pick, send, keep } = require('./call');

const KEY = 'api-service-jobs';
let SECOND = 1000;   // tests make a second shorter, never anything else
const _live = new Map();   // id → { timer, waiters: Set<fn> }

const all = () => docs().getDoc(KEY, { jobs: [] }).jobs || [];
function patch(id, fields) {
  const list = all().map(j => (j.id === id ? { ...j, ...fields } : j));
  docs().setDoc(KEY, { jobs: list.slice(-50) });
  return list.find(j => j.id === id);
}
const get = id => all().find(j => j.id === id || j.remote === id) || null;
const short = (v, n) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);

/** Start following a job: `answer` is the submit's JSON (or `remote`, a job id given to follow). */
function start(def, a, { answer = null, remote = null, sessionId = null, user = null, saveAs = '' } = {}) {
  const id = remote ? String(remote) : pick(answer, a.job.id);
  if (id === undefined || id === null || id === '') throw Object.assign(new Error(`the answer has no job id at ${a.job.id}`), { status: 502 });
  const rec = { id: `sj_${crypto.randomBytes(4).toString('hex')}`, service: def.name, operation: a.name, remote: String(id).slice(0, 300), state: 'running',
    sessionId, person: user?.id ? { id: user.id, name: user.name || user.email || user.id, role: user.role } : null,
    saveAs: String(saveAs || '').replace(/[\\/]/g, '_').slice(0, 80), startedAt: new Date().toISOString(), polls: 0, errors: 0, status: null };
  docs().setDoc(KEY, { jobs: [...all(), rec].slice(-50) });
  _live.set(rec.id, { timer: null, waiters: new Set() });
  next(rec.id, a.job.every);
  require('../activity').note({ from: 'services', what: `following ${def.name} ${a.name} (job ${rec.remote.slice(0, 40)})`, why: 'an agent submitted it; the hub asks after it until it ends', person: rec.person, sessionId });
  return rec;
}

function next(id, every) {
  const live = _live.get(id);
  if (!live) return;
  live.timer = setTimeout(() => poll(id).catch(e => end(id, { state: 'failed', message: e.message })), Math.max(1, every) * SECOND);
  live.timer.unref?.();
}

async function poll(id) {
  const rec = get(id);
  if (!rec || rec.state !== 'running') return;
  const def = require('./store').get(rec.service);
  const a = def?.actions.find(x => x.name === rec.operation);
  const p = a && def.actions.find(x => x.name === a.job?.poll.operation);
  if (!p) return end(id, { state: 'failed', message: `the service "${rec.service}" or its actions changed while the job ran` });
  const job = a.job;
  const param = job.poll.param || (p.params || []).find(x => x.required)?.name || (p.params || [])[0]?.name || 'id';
  const user = rec.person ? { id: rec.person.id, name: rec.person.name, role: rec.person.role } : null;
  const res = await send(def, p, { params: { [param]: rec.remote }, ctx: { user } });
  const polls = rec.polls + 1, overdue = Date.now() - Date.parse(rec.startedAt) > job.giveUp * SECOND;
  const retry = why => {
    const errors = rec.errors + 1;
    if (errors >= 6 || overdue) return end(id, { state: 'failed', polls, message: `asking after it failed ${errors} times: ${why}` });
    patch(id, { polls, errors });
    return next(id, job.every);
  };
  if (res.error) return retry(res.error.replace(/^Error: /, ''));
  if (res.status === 429 || res.status >= 500 || !res.json) return retry(`HTTP ${res.status}${res.json ? '' : ', not JSON'}`);
  if (!res.ok) return end(id, { state: 'failed', polls, message: `HTTP ${res.status}: ${short(res.text, 300)}` });
  const said = job.message ? pick(res.json, job.message) : null;
  if (job.ok && !job.ok.values.map(String).includes(String(pick(res.json, job.ok.path))))
    return end(id, { state: 'failed', polls, message: short(said || res.text, 300) });
  const status = String(pick(res.json, job.status) ?? '');
  const is = list => list.some(v => v.toLowerCase() === status.toLowerCase());
  if (is(job.failed)) return end(id, { state: 'failed', polls, status, message: short(said || status, 300) });
  if (!is(job.done)) {
    if (overdue) return end(id, { state: 'gave-up', polls, status, message: `still "${status}" after ${Math.round(job.giveUp / 60)} min` });
    patch(id, { polls, errors: 0, status });
    return next(id, job.every);
  }
  // Done: keep what it made. The first result is the thing itself, the others named after where they were (cover_url → -cover).
  const base = rec.saveAs || `${rec.service}-${rec.remote.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'result'}`;
  const files = [], missed = [];
  for (const [k, path] of job.result.entries()) {
    for (const [n, url] of [].concat(pick(res.json, path) ?? []).filter(u => typeof u === 'string' && u).slice(0, 4).entries()) {
      const tail = k === 0 ? '' : `-${path.split(/[.[]/).pop().replace(/_?url\]?$/i, '').replace(/\W/g, '') || k}`;
      const kept = await keep(def, url, `${base}${tail}${n ? `-${n + 1}` : ''}${job.ext && k === 0 && !/\.[a-z0-9]+$/i.test(new URL(url, 'http://x').pathname) ? `.${job.ext}` : ''}`, { ctx: { user } });
      if (kept.error) missed.push(kept.error); else files.push(kept);
    }
  }
  return end(id, { state: 'done', polls, status, files, ...(missed.length ? { message: `not kept: ${missed.join('; ')}` } : {}),
    ...(!job.result.length || (!files.length && !missed.length) ? { message: 'the service said it is done but gave no result address' } : {}) });
}

/** A job's end: recorded, written in the activity log, and told to whoever waits — the call, or the conversation. */
function end(id, fields) {
  const live = _live.get(id);
  if (live?.timer) clearTimeout(live.timer);
  const rec = patch(id, { ...fields, endedAt: new Date().toISOString() });
  _live.delete(id);
  if (!rec) return null;
  require('../activity').note({ from: 'services', what: `${rec.service} ${rec.operation} ${rec.state}${rec.files?.length ? `: kept ${rec.files.map(f => f.name).join(', ')}` : ''}`,
    why: rec.message || 'its job ended', person: rec.person, sessionId: rec.sessionId, level: rec.state === 'done' ? 'info' : 'warn' });
  const waiters = live ? [...live.waiters] : [];
  for (const w of waiters) w(rec);
  if (!waiters.length) tell(rec);
  return rec;
}

/** What the agent reads about a job that ended — the hub's own words, the service's message framed as outside words. */
function sentence(rec) {
  const head = `Service job ${rec.id} (${rec.service} ${rec.operation}, its id there ${rec.remote}) ${rec.state === 'done' ? 'is done' : rec.state === 'gave-up' ? 'was given up' : rec.state === 'interrupted' ? 'was interrupted by a restart' : 'failed'}.`;
  const files = (rec.files || []).map(f => `- ${f.name} (${f.size}, ${f.path})${f.model ? ' — a 3D model' : ''}`);
  const said = rec.message ? `\n${require('../harness/untrusted').frame(`the service ${rec.service}`, rec.message)}` : '';
  const how = rec.state === 'done' && files.length ? '\nShow it with show_media.'
    : rec.state === 'interrupted' || rec.state === 'gave-up' ? `\nIt may have finished at the service: service call ${rec.service} ${rec.operation} with follow "${rec.remote}" takes it up again.`
      : rec.state === 'failed' ? '\nSay what failed; do not submit it again unless the person asks.' : '';
  return `${head}${files.length ? `\nKept:\n${files.join('\n')}` : ''}${said}${how}`;
}

/** Tell the conversation: a specialist that has finished hands it to the work chat that sent it. */
function tell(rec) {
  if (!rec.sessionId || rec.told) return;
  patch(rec.id, { told: new Date().toISOString() });
  const memory = require('../harness/memory');
  let target = rec.sessionId;
  const s = memory.getSession(target);
  if (!s) return;
  if (s.kind === 'specialist') {
    const m = require('../agents/missions').forSession(target);
    if (m && m.state !== 'running' && m.by && memory.getSession(m.by)) target = m.by;
  }
  const text = `[panel] ${sentence(rec)}`;
  if (require('../harness/supervisor').wake(target, text) === 'woken') return;
  // Working, or no automatic turns now: read before its next step, or by the next turn there (inbox.js).
  try { require('../harness/inbox').put(target, { message: text, client: { name: 'DOCA', kind: 'agent' } }); } catch { /* the inbox is full: the activity line and service list say it */ }
}

/** Wait up to `ms` for a job to end: the record, or null when it is still running (it is then told to the conversation). */
function wait(id, ms) {
  const live = _live.get(id);
  if (!live || ms <= 0) return Promise.resolve(null);
  return new Promise(resolve => {
    const done = rec => { clearTimeout(t); resolve(rec); };
    const t = setTimeout(() => { live.waiters.delete(done); resolve(null); }, ms);
    live.waiters.add(done);
  });
}

/** After a restart: jobs that were followed are not any more — say so, once, where they started. */
function recover() {
  for (const j of all().filter(x => x.state === 'running')) end(j.id, { state: 'interrupted', message: 'DOCA restarted while it was following this job' });
}

const list = ({ service, sessionId } = {}) => all().filter(j => (!service || j.service === service) && (!sessionId || j.sessionId === sessionId)).reverse();
const _unit = ms => { SECOND = ms; };

module.exports = { start, wait, recover, list, get, sentence, end, _unit };

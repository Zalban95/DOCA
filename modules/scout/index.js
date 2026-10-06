'use strict';

/**
 * The model scout (experiment `modelScout`; docs/experiments/model-scout.md). Better models, and models that do
 * something new, appear every week; DOCA is built so each function's model is a setting or a catalog row. The scout
 * closes the loop:
 *
 *   1. Look (signals.js, no model): Hugging Face's trending models for each task DOCA uses (roles.js), growth since the
 *      last look, new releases of the projects DOCA runs on, the owner's news feeds. Daily, while switched on.
 *   2. Brief (a turn, in the conversation "Model scout", as the person who switched it on): the agent reads the
 *      signals through the `scout` tool (framed as outside words), sends the scout specialist to read what deserves
 *      reading, and files suggestions — a candidate, the function it would replace or the capability it would add, why,
 *      the evidence, how to try it in DOCA. Every `scout.everyDays`, or at once when a look finds something notable.
 *   3. Decide (a person, Settings → Harness → Scout): accept — the suggestion becomes a line in TODO.md of the
 *      repository (`scout.repo`, by default this install's own checkout) — or decline with a reason the next brief reads.
 *   4. Work (a person's click): an accepted suggestion goes to an implementer — DOCA's own agent in a conversation of
 *      its own, or a CLI harness (Claude Code, Codex…) asked once in the repository — following the doca-dev-cycle
 *      skill: branch, build, test, commit, and the owner's yes before merge, tag and push.
 *
 * The routine is off by default (`scout.enabled`), the whole is an experiment (developer mode), and nothing in it
 * changes a setting or installs anything: suggestions are proposals, and the work is a conversation that asks.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const sc = () => require('../settings-schema');
const settings = () => ({
  enabled: sc().value('scout.enabled'), everyDays: sc().value('scout.everyDays'), growthLikes: sc().value('scout.growthLikes'),
  watch: sc().value('scout.watch') || [], feeds: sc().value('scout.feeds') || [], repo: sc().value('scout.repo'), implementer: sc().value('scout.implementer'),
});
const on = () => require('../experiments').on('modelScout');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const dir = () => path.join(require('../store').DATA_DIR, 'scout');
const file = n => path.join(dir(), n);
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const write = (n, v) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(v, null, 2)); };
const state = () => read('state.json', {});
const setState = p => write('state.json', { ...state(), ...p });

// ── Suggestions ─────────────────────────────────────────────────────────────

const list = () => read('suggestions.json', []);
const saveList = xs => write('suggestions.json', xs);
const get = id => list().find(s => s.id === id);
const patch = (id, p) => { const xs = list().map(s => (s.id === id ? { ...s, ...p } : s)); saveList(xs); return xs.find(s => s.id === id); };

/** Filed by the agent (the `scout` tool). The same candidate for the same function is the first one, not a second card. */
function suggest(a) {
  const title = String(a.title || '').trim().slice(0, 160);
  if (!title) throw bad('A suggestion needs a title.');
  const role = String(a.role || 'new').trim().slice(0, 40);
  const candidate = String(a.candidate || '').trim().slice(0, 200);
  const dup = list().find(s => s.role === role && candidate && s.candidate.toLowerCase() === candidate.toLowerCase());
  if (dup) return dup;
  const xs = list();
  const n = xs.reduce((m, s) => Math.max(m, Number(String(s.id).slice(1)) || 0), 0) + 1;
  const clip = (v, k) => String(v || '').trim().slice(0, k);
  const s = { id: `S${n}`, title, role, candidate, replaces: clip(a.replaces, 200), why: clip(a.why, 1500),
    evidence: (Array.isArray(a.evidence) ? a.evidence : []).map(e => clip(e, 300)).slice(0, 12), tryWith: clip(a.tryWith, 600),
    state: 'pending', at: new Date().toISOString() };
  saveList([...xs, s]);
  return s;
}

/** The repository whose TODO.md takes accepted suggestions: the setting, else this install's own checkout (a running
 *  release is a worktree under .releases/, so the main checkout is found through git's common directory). */
function repo() {
  const set = settings().repo;
  if (set) return set;
  try {
    const common = execFileSync('git', ['-C', path.join(__dirname, '..', '..'), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 10000 }).trim();
    return path.dirname(common);
  } catch { return null; }
}

/** The line it becomes in TODO.md, under "## Scout suggestions". */
function todoLine(s, who) {
  return `- [ ] **${s.id}** ${s.title} — ${s.role}${s.replaces ? ` (replaces ${s.replaces})` : ''}${s.candidate ? `; candidate: ${s.candidate}` : ''}. ${s.why.split('\n')[0].slice(0, 300)}`
    + `${s.tryWith ? ` Try: ${s.tryWith.split('\n')[0].slice(0, 200)}` : ''} (scout, accepted ${new Date().toISOString().slice(0, 10)}${who ? ` by ${who}` : ''})`;
}

function accept(id, who) {
  const s = get(id);
  if (!s) throw bad('No such suggestion.', 404);
  if (s.state !== 'pending') return s;
  const root = repo();
  if (!root) throw bad('No repository for TODO.md: set scout.repo (Settings → Harness → Scout).', 409);
  const todo = path.join(root, 'TODO.md');
  let text = '';
  try { text = fs.readFileSync(todo, 'utf8'); } catch { /* a repository without one gets one */ }
  const line = todoLine(s, who);
  const head = '## Scout suggestions';
  const at = text.indexOf(head);
  if (at < 0) text = `${text.replace(/\s*$/, '')}\n\n${head}\n\nAccepted from the model scout (docs/experiments/model-scout.md); each follows the dev cycle (skills/doca-dev-cycle).\n\n${line}\n`;
  else {   // at the end of its section, before the next heading
    const next = text.indexOf('\n## ', at + head.length);
    const end = next < 0 ? text.length : next;
    text = `${text.slice(0, end).replace(/\s*$/, '')}\n${line}\n${next < 0 ? '' : `\n${text.slice(end + 1)}`}`;
  }
  fs.writeFileSync(todo, text);
  return patch(id, { state: 'accepted', todo: line, todoFile: todo, decidedAt: new Date().toISOString(), by: who || null });
}

function decline(id, reason, who) {
  const s = get(id);
  if (!s) throw bad('No such suggestion.', 404);
  return patch(id, { state: 'declined', reason: String(reason || '').slice(0, 300), decidedAt: new Date().toISOString(), by: who || null });
}

const workMessage = (s, root) => `Implement scout suggestion ${s.id} in the repository at ${root} (its line in TODO.md: ${s.todo || s.title}).\n\n`
  + `What: ${s.title}. Function: ${s.role}${s.replaces ? `, replacing ${s.replaces}` : ''}. Candidate: ${s.candidate || '—'}.\nWhy: ${s.why}\nHow to try it: ${s.tryWith || '—'}\n\n`
  + 'Follow the doca-dev-cycle skill (read it first), the repository\'s CONSTITUTION.md and AGENTS.md: a branch of its own, the change behind a setting or a '
  + 'catalog row so the old way stays available (interchangeable, local or remote), tests, the panel checked, one logical change per commit. '
  + 'Ask before merging, tagging or pushing unless CONSTITUTION.md W2 lets your model release. When done, tick its line in TODO.md and say what you ran and what it printed.';

/** Hand an accepted suggestion to the implementer: DOCA's own agent, or a CLI harness asked once in the repository. */
async function work(id, person) {
  const s = get(id);
  if (!s) throw bad('No such suggestion.', 404);
  if (!['accepted', 'failed'].includes(s.state)) throw bad('Accept it first: the work starts from its TODO line.', 409);
  const root = repo();
  if (!root) throw bad('No repository: set scout.repo.', 409);
  const impl = settings().implementer || 'doca';
  const message = workMessage(s, root);
  if (impl === 'doca') {
    const memory = require('../harness/memory');
    const sessionId = memory.createSession(`${s.id} · ${s.title}`.slice(0, 120), { activate: false }).id;
    if (person) require('../harness/session-access').claim(person, sessionId);
    patch(id, { state: 'working', implementer: 'doca', sessionId, startedAt: new Date().toISOString() });
    require('../harness/agent').send({ message, sessionId, client: { name: `Scout · ${s.id}`, kind: 'schedule', user: person } })
      .then(() => patch(id, { state: 'done', endedAt: new Date().toISOString() }), e => patch(id, { state: 'failed', error: e.message.slice(0, 300) }));
    return get(id);
  }
  const catalog = require('../harness/catalog'), oneShot = require('../harness/one-shot');
  const row = catalog.get(impl);
  const adapter = row && oneShot.adapterFor(row);
  if (!adapter || adapter.kind === 'gateway') throw bad(`${impl} cannot be asked once from here (${row ? oneShot.whyNot(row) : 'no such harness'}).`, 409);
  const log = file(`work-${s.id}.log`);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(log, `# ${impl} in ${root}\n\n`);
  patch(id, { state: 'working', implementer: impl, log, startedAt: new Date().toISOString() });
  oneShot.ask(adapter, { message, cwd: root, timeoutMs: 3 * 3600e3, onText: t => fs.appendFileSync(log, t), onErr: t => fs.appendFileSync(log, t) })
    .then(r => patch(id, { state: r.code === 0 ? 'done' : 'failed', endedAt: new Date().toISOString(), ...(r.code === 0 ? {} : { error: r.error || `exit ${r.code}` }) }));
  return get(id);
}

// ── The routine ─────────────────────────────────────────────────────────────

const BRIEF = 'Model scout run (docs/experiments/model-scout.md). 1) Call `scout` with action "signals" — the latest look: trending '
  + 'models for each function DOCA uses, with growth, and new releases and news; and action "list" for what was suggested and decided '
  + 'before (do not suggest again what was declined, and read why). 2) Pick what could do one of DOCA\'s functions clearly better (quality, '
  + 'speed, size, licence, runs locally) or adds a capability DOCA lacks. For each worth it, find out what it needs and how it runs (send the '
  + 'scout specialist when specialists are on; a model card and its benchmarks, not a headline). 3) File each that holds up with `scout` '
  + 'action "suggest" — at most five, best first — saying the function, what it replaces, why, the evidence, and how it would be tried in '
  + 'DOCA without breaking the current way: a model name for a setting, a Services or System tools row, a new reader, a new function. '
  + 'Prefer what is open, runs on any OS, locally or remotely, and can be swapped out again. 4) Answer in one line: how many filed. Change '
  + 'no setting and install nothing: a person decides.';

/** The person the routine runs as: who switched it on, else the first active owner. */
function person() {
  const client = require('../harness/turn/client'), store = require('../auth/store');
  const orgId = store.defaultOrg()?.id || null;
  const by = state().by;
  if (by) { const p = client.personById({ id: by, orgId }); if (p) return p; }
  const owner = orgId && store.membersOf(orgId).find(m => m.role === 'owner' && m.status === 'active');
  return owner ? client.personById({ id: owner.userId, orgId }) : null;
}

/** One brief now: a turn in the scout's own conversation. */
async function brief(why = 'asked') {
  const who = person();
  if (!who) throw bad('No owner to run the scout as.', 409);
  const memory = require('../harness/memory');
  let sessionId = state().sessionId;
  if (!sessionId || !memory.getSession(sessionId)) {
    sessionId = memory.createSession('Model scout', { activate: false }).id;
    require('../harness/session-access').claim(who, sessionId);
  }
  setState({ sessionId, lastBriefAt: new Date().toISOString(), lastBriefWhy: why });
  return require('../harness/agent').send({ message: BRIEF, sessionId, client: { name: 'Model scout', kind: 'schedule', user: who } });
}

let _busy = false;
/** Hourly: a look once a day, and a brief when one is due or a look found something notable. */
async function tick(now = Date.now()) {
  const s = settings();
  if (!on() || !s.enabled || _busy) return null;
  _busy = true;
  try {
    const st = state();
    let notable = [];
    if (!st.lastLookAt || now - Date.parse(st.lastLookAt) >= 20 * 3600e3) {
      const r = await require('./signals').look();
      notable = r.notable;
      setState({ lastLookAt: r.at, lastNotable: notable });
    }
    const due = !st.lastBriefAt || now - Date.parse(st.lastBriefAt) >= s.everyDays * 86400e3;
    if (due || notable.length) await brief(due ? 'due' : `notable: ${notable.map(n => n.what).slice(0, 3).join(', ')}`);
    return { notable, briefed: due || notable.length > 0 };
  } finally { _busy = false; }
}

let _timer = null;
function start() { if (_timer) return; _timer = setInterval(() => tick().catch(() => {}), 3600e3); _timer.unref?.(); setTimeout(() => tick().catch(() => {}), 60e3).unref?.(); }

/** Switched on or off from the panel: the person who did it is who the routine runs as. */
function enable(value, who) {
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, scout: { ...(prefs.scout || {}), enabled: value === true } });
  if (value === true && who?.id) setState({ by: who.id });
  return settings();
}

module.exports = { settings, on, list, get, suggest, accept, decline, work, repo, todoLine, workMessage, brief, tick, start, enable, state, BRIEF };

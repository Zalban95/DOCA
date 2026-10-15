'use strict';

/**
 * Other agents on this machine, step by step (asked 2026-10-15): the Workstream already says when another agent's
 * process starts or ends (workstream/outside.js); this says what it does, by two routes —
 *   record   the agent's own session records, tailed by byte while a page holds the Workstream (claude.js, codex.js,
 *            gemini.js; tail.js reads only this account's own files, never through a link)
 *   otel     what the agent exports over OpenTelemetry to the hub's own receiver on 127.0.0.1 (otel/), which runs only
 *            while an agent that speaks it is running
 * Each step becomes one Workstream line in fixed words (words.js) — "Claude Code · doca: $ npm test" — said once
 * however it arrived (dedupe.js), kept for Chronicle (source `outside`, a host's), and an edit it names labels the file
 * change the sentinel sees (workstream/who.js). Names, paths and commands only, secrets masked: never a conversation,
 * thinking or a tool's result. Off by default, and only the owner switches it on (`outsideAgents.enabled`, never
 * proposable: reading other programs' records is a person's decision); licensed as the feature `outside-agents`.
 * Mechanical: no model is asked anything and no agent posts here.
 */
const path = require('path');
const tail = require('./tail');
const words = require('./words');
const dedupe = require('./dedupe');

const AGENTS = [require('./claude'), require('./codex'), require('./gemini')];
const T = { lookMs: 3000, maxSteps: 40, recentMs: 60000 };

let _on = false, _timer = null, _lastLook = 0, _looking = null, _since = 0;
let _reader = tail.reader();
const _whole = new Map();     // a whole-document record (Gemini's) → its state
const _ring = [];             // the steps said, for Chronicle
const _sessions = new Map();  // `${agent}|${session}` → { cwd, at } — where a session works, for OpenTelemetry's steps
const _edits = new Map();     // file → { at, step } — for who.js
const _where = new Map();     // cwd → { at, title }
const counts = { record: 0, otel: 0, twice: 0 };

const setting = k => { try { return require('../settings-schema').value(`outsideAgents.${k}`); } catch { return null; } };
const licensed = () => { try { return require('../license').featureOn('outside-agents'); } catch { return true; } };
/** Whether the owner switched it on here (and it is licensed). */
const enabled = () => !!setting('enabled') && licensed();

/** Where a folder is, as the Workstream names it: its project or repository (workstream/outside.js), kept a minute. */
async function whereOf(cwd) {
  if (!cwd) return null;
  const old = _where.get(cwd);
  if (old && Date.now() - old.at < 60000) return old.title;
  let title = path.basename(cwd);
  try { const w = await require('../workstream/outside').whereOf({ cwd, args: [] }); if (w && !/^Outside /.test(w)) title = w; } catch { /* the folder's name */ }
  _where.set(cwd, { at: Date.now(), title });
  if (_where.size > 200) _where.delete(_where.keys().next().value);
  return title;
}

/** A Gemini project hash, named by the folders Gemini sessions work in and DOCA's projects. */
async function geminiCwd(hash) {
  if (!hash) return null;
  const dirs = new Set();
  try { for (const p of require('./otel/life').running()) if (p.agent === 'gemini' && p.cwd) dirs.add(p.cwd); } catch { /* none known */ }
  try { for (const pr of require('../projects/store').list()) if (pr.root) dirs.add(pr.root); } catch { /* none */ }
  const g = require('./gemini');
  return [...dirs].find(d => g.hashOf(d) === hash) || null;
}

/** Say one step (from either route): once, in fixed words, on the Workstream and for Chronicle. */
async function say(step, via) {
  if (step.command) step.command = words.mask(step.command);   // masked before anything keeps it, the same way by both routes
  const key = `${step.agent}|${step.session}`;
  if (step.cwd) _sessions.set(key, { cwd: step.cwd, at: Date.now() });
  else if (_sessions.has(key)) step.cwd = _sessions.get(key).cwd;
  else if (step.project) step.cwd = await geminiCwd(step.project);
  else if (via === 'otel') step.cwd = require('./otel/life').cwdOf(step.agent);
  if (_sessions.size > 500) _sessions.delete(_sessions.keys().next().value);
  if (dedupe.again(step, via)) { counts.twice++; return null; }
  counts[via]++;
  for (const f of step.kind === 'edit' ? step.files || [] : []) _edits.set(path.resolve(step.cwd || '/', f), { at: Date.now(), step });
  if (_edits.size > 1000) for (const [f, e] of _edits) if (Date.now() - e.at > T.recentMs) _edits.delete(f);
  const who = words.who(step, await whereOf(step.cwd)), text = words.what(step);
  const extra = { agent: { id: step.agent, session: String(step.session || '').slice(0, 8), via } };
  require('../workstream').outside(who, text, extra);
  _ring.push({ ts: new Date().toISOString(), level: step.failed ? 'warn' : 'info', text: `${who}: ${text}`, agent: step.agent, via });
  const max = (() => { try { return require('../log-keep').limit('logs.workstreamLines'); } catch { return 300; } })();
  if (_ring.length > max) _ring.splice(0, _ring.length - max);
  return { who, text };
}

/** True when a record file was made after reading began (its birth time; where the OS has none, a small file changed since). */
function bornSince(file) {
  const st = tail.own(file);
  if (!st) return false;
  return st.birthtimeMs > 0 ? st.birthtimeMs >= _since - 1000 : st.size < tail.CAP && st.mtimeMs >= _since;
}

/** Read what the records gained since the last look (`prime`: only learn where each file ends, saying nothing). */
async function look({ prime = false } = {}) {
  _lastLook = Date.now();
  const steps = [];
  for (const a of AGENTS) {
    for (const { file } of a.files(tail.find)) {
      const fromStart = !prime && bornSince(file);   // a session begun since: from its first line; one resumed: from its end
      if (a.whole) {
        if (!_whole.has(file)) _whole.set(file, {});
        steps.push(...a.read(file, _whole.get(file), fromStart, tail.own));
        continue;
      }
      if (!_reader.has(file)) { const k = _reader.know(file, fromStart); if (!fromStart) a.head?.(file, k.meta); }
      if (prime) continue;
      const { lines, meta } = _reader.lines(file);
      for (const l of lines) steps.push(...a.parse(l, meta));
    }
  }
  if (prime) return 0;
  steps.sort((x, y) => x.at - y.at);
  for (const s of steps.slice(-T.maxSteps)) await say(s, 'record');
  if (steps.length > T.maxSteps) require('../workstream').outside('Other agents', `${steps.length - T.maxSteps} more steps in this look, not shown one by one`, {});
  return steps.length;
}

async function tick() {
  _timer = null;
  if (!_on) return;
  try { _looking = look(); await _looking; } catch { /* the next look tries again */ } finally { _looking = null; }
  if (!_on) return;
  _timer = setTimeout(tick, T.lookMs);
  _timer.unref?.();
}

/** A page holds the Workstream: read the records while it does, when switched on (idempotent). */
async function start() {
  require('./otel/life').sync().catch(() => {});   // and the receiver follows the switch (otel/life.js)
  if (_on || !enabled()) return;
  _on = true; _since = Date.now();
  try { await look({ prime: true }); } catch { /* the first look learns them */ }
  _timer = setTimeout(tick, T.lookMs);
  _timer.unref?.();
}

/** Nobody holds it, or it was switched off: stop reading. What happened meanwhile is not said later. */
function stop() {
  _on = false;
  clearTimeout(_timer); _timer = null;
  _reader = tail.reader(); _whole.clear();
}

/** Look now unless a look ended under a second ago (who.js, before naming who wrote a file). */
async function fresh() {
  if (!_on) return;
  if (_looking) { await _looking.catch(() => {}); return; }
  if (Date.now() - _lastLook > 1000) { _looking = look(); try { await _looking; } catch { /* next time */ } finally { _looking = null; } }
}

/** The step of another agent that edited `file` in the last minute, as who.js says it — or null. */
function editedBy(file) {
  const e = _edits.get(path.resolve(file));
  if (!e || Date.now() - e.at > T.recentMs) return null;
  const s = e.step;
  return { agent: s.agent, label: s.label, session: String(s.session || '').slice(0, 8), text: `${s.label}${s.sub ? ' (subagent)' : ''} session ${String(s.session || '').slice(0, 8)} edited it` };
}

/** Steps arriving over OpenTelemetry (otel/receiver.js), said like the records' own. */
async function ingest(steps) {
  if (!enabled()) return 0;
  let n = 0;
  for (const s of steps.slice(0, 200)) if (await say(s, 'otel')) n++;
  return n;
}

/** For Settings and the Workstream's bar: on, reading, what was found, what was said. */
function status() {
  return { enabled: !!setting('enabled'), licensed: licensed(), reading: _on, files: _reader.size() + _whole.size, counts: { ...counts },
    agents: AGENTS.map(a => ({ id: a.id, label: a.label, records: a.roots()[0], found: a.files(tail.find).length })) };
}

const lines = () => _ring.slice();

module.exports = { start, stop, look, fresh, say, ingest, editedBy, status, enabled, lines, T, AGENTS, on: () => _on,
  _reset: () => { stop(); _ring.length = 0; _sessions.clear(); _edits.clear(); _where.clear(); dedupe._reset(); Object.assign(counts, { record: 0, otel: 0, twice: 0 }); } };

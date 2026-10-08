'use strict';

/**
 * What the hub keeps of what happened, how much and for how long (TODO P1.12; CONSTITUTION §1: "nothing runs unseen,
 * but it can be unrendered … when those tabs are not open, the work is only logged — and the log has its own
 * settings, so it never fills memory or disk needlessly").
 *
 * Every store that records what happened is one row here: where it lives (memory or disk), the settings that bound it
 * (declared in settings-schema.js under `logs` and `tracing`, read through `schema.value()`), and how much it holds
 * now. The rings read their size through `limit()`, cached for a few seconds because a ring is pushed on every event
 * and `schema.value()` reads the prefs file. `prune()` runs at start and daily (boot.js) and after a save.
 *
 * Some stores are bounded by something other than a log setting and are shown as fixed, with why: settings
 * checkpoints and migration copies are ways back (CONSTITUTION S9), a device's queue is a protocol limit every client
 * reads from /api/v1/capabilities. None of these settings is proposable: a retention an agent could shorten is one that
 * could erase the record of what agents did.
 */
const fs = require('fs');
const path = require('path');

const schema = () => require('./settings-schema');
const raw = () => require('./db').syncHandle();
const dataDir = () => require('./store').DATA_DIR;

/* ── The limits, as the rings read them ───────────────── */

const CACHE_MS = 5000;
let _cache = { at: 0, prefs: null };

/** A declared limit, read through the schema with a short cache — cheap enough for every event. */
function limit(dotted) {
  if (!_cache.prefs || Date.now() - _cache.at > CACHE_MS) _cache = { at: Date.now(), prefs: require('./utils').loadPrefs() };
  return schema().value(dotted, _cache.prefs);
}
const forget = () => { _cache = { at: 0, prefs: null }; };

/* ── How much each holds ──────────────────────────────── */

/** Files and bytes under a folder (bounded walk: a log folder, not a disk). */
function folder(dir, max = 20000) {
  let files = 0, bytes = 0;
  const stack = [dir];
  while (stack.length && files < max) {
    const at = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(at, e.name);
      if (e.isDirectory()) stack.push(p);
      else { files++; try { bytes += fs.statSync(p).size; } catch { /* gone meanwhile */ } }
    }
  }
  return { files, bytes };
}

function table(sql) {
  try { return raw()?.prepare(sql).get() || null; } catch { return null; }
}

const json = v => { try { return Buffer.byteLength(JSON.stringify(v)); } catch { return 0; } };

function mcpLines() {
  const reg = require('./mcp/registry');
  let lines = 0, bytes = 0;
  for (const def of reg.load()) { const log = reg.client(def.id)?.log || []; lines += log.length; bytes += json(log); }
  return { lines, bytes };
}

/** Every store, with its settings and what it holds now. Each reading fails alone, as `null`. */
function usage() {
  const read = fn => { try { return fn(); } catch { return null; } };
  const setting = p => ({ path: p, value: limit(p), ...schema().leaf(p) });
  const ring = read(() => require('./logs')._ring);
  const ws = read(() => require('./workstream').size());
  const mcp = read(mcpLines);
  const call = read(() => require('./realtime/call-log').size());
  const runs = table("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(COALESCE(outcome,'')) + LENGTH(COALESCE(detail,'')) + 200), 0) AS b FROM runs WHERE tenant_id = 'local'");
  const spans = table("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(COALESCE(data,'')) + 80), 0) AS b FROM trace_spans WHERE tenant_id = 'local'");
  const jobs = read(() => folder(path.join(dataDir(), 'harness', 'jobs')));
  const evals = read(() => folder(path.join(dataDir(), 'evals', 'results')));
  const fixed = sub => read(() => folder(path.join(dataDir(), sub)));
  const db = n => (n == null ? null : Number(n));
  return { stores: [
    { id: 'harness', label: 'Harness log', where: 'memory', what: 'what each turn did, a line per step and tool (Hub → Logs)',
      entries: ring?.length ?? null, bytes: ring ? json(ring) : null, settings: [setting('logs.harnessLines')] },
    { id: 'workstream', label: 'Workstream activity', where: 'memory', what: 'thinking, commands and results as they happened (Agents → Workstream)',
      entries: ws?.lines ?? null, bytes: ws?.bytes ?? null, settings: [setting('logs.workstreamLines')] },
    { id: 'mcp', label: 'MCP servers\' output', where: 'memory', what: 'what each server printed, per server (Field → MCP)',
      entries: mcp?.lines ?? null, bytes: mcp?.bytes ?? null, settings: [setting('logs.mcpLines')] },
    { id: 'calls', label: 'Live calls', where: 'memory', what: 'each stage of each live call: audio heard, transcripts (counted, never the words), turns, answers spoken (Hub → Logs)',
      entries: call?.lines ?? null, bytes: call?.bytes ?? null, settings: [setting('logs.callLines')] },
    { id: 'runs', label: 'Runs', where: 'disk', what: 'one record per turn, mission and device job: who, how it ended, what it cost (Chronicle)',
      entries: db(runs?.n), bytes: db(runs?.b), approx: true, settings: [setting('logs.runsRetainDays')] },
    { id: 'traces', label: 'Traces', where: 'disk', what: 'each run step by step: model requests, tool calls, waits — names and numbers, never content',
      entries: db(spans?.n), bytes: db(spans?.b), approx: true, settings: [setting('tracing.retainDays'), setting('tracing.maxSpans')], enabled: limit('tracing.enabled') },
    { id: 'activity', label: 'What the hub did on its own', where: 'disk', what: 'a line per act without a turn: a computer tidied away, a server resumed, a schedule fired (Chronicle)',
      ...files(read(() => folder(require('./activity').dir()))), settings: [setting('logs.activityDays')] },
    { id: 'jobs', label: 'Background jobs', where: 'disk', what: 'commands left running (shell_job) with their output',
      entries: jobs?.files ?? null, bytes: jobs?.bytes ?? null, settings: [setting('logs.jobsKept')] },
    { id: 'evals', label: 'Evaluation results', where: 'disk', what: 'each run of an evaluation set (Settings → Evaluations)',
      entries: evals?.files ?? null, bytes: evals?.bytes ?? null, settings: [setting('logs.evalResultsKept')] },
    { id: 'checkpoints', label: 'Settings checkpoints', where: 'disk', what: 'the settings before each change', fixed: 'the last 200 — a way back, not a log',
      ...files(fixed('checkpoints')), settings: [] },
    { id: 'migrations', label: 'Migration copies', where: 'disk', what: 'the settings file before each migration', fixed: 'the last 10 — a way back, not a log',
      ...files(fixed('migrations')), settings: [] },
    { id: 'backups', label: 'write_file backups', where: 'disk', what: 'the version a file had before the agent last wrote it', fixed: 'one per file, replaced at each write — a way back',
      ...files(fixed(path.join('harness', 'backups'))), settings: [] },
    { id: 'outbox', label: 'Device queues', where: 'disk', what: 'what is waiting for devices that are away',
      fixed: `${require('./api-v1/limits').OUTBOX_MAX_EVENTS} events and ${require('./api-v1/limits').OUTBOX_MAX_HOURS} h per device — a protocol limit every client reads`,
      ...files(fixed('outbox')), settings: [] },
  ] };
}
function files(f) { return { entries: f?.files ?? null, bytes: f?.bytes ?? null }; }

/* ── Keeping to them ──────────────────────────────────── */

/** Every bound on disk applied now. Never throws; says what it removed. */
function prune() {
  const removed = {};
  const step = (k, fn) => { try { removed[k] = fn() || 0; } catch { removed[k] = 0; } };
  step('traces', () => require('./harness/trace').prune());
  step('runs', () => require('./harness/runs').prune(limit('logs.runsRetainDays')));
  step('jobs', () => require('./harness/jobs').prune());
  step('evals', () => require('./evals/store').pruneAll());
  step('activity', () => require('./activity').prune(limit('logs.activityDays')));
  const any = Object.entries(removed).filter(([, n]) => n > 0);
  if (any.length) require('./activity').note({ from: 'log-keep', what: `removed ${any.map(([k, n]) => `${n} ${k}`).join(', ')}`, why: 'older or more than the log settings keep' });
  return removed;
}

let _timer = null;
function start() {
  prune();
  if (!_timer) _timer = setInterval(prune, 86400000).unref();
}

/* ── Changing them (Settings → System → Logs) ─────────── */

// tracing.enabled is shown, not switched here: whether runs are traced at all is evidence of what agents did (S14).
const EDITABLE = ['logs.harnessLines', 'logs.workstreamLines', 'logs.mcpLines', 'logs.callLines', 'logs.runsRetainDays', 'logs.jobsKept', 'logs.evalResultsKept', 'logs.activityDays',
  'tracing.retainDays', 'tracing.maxSpans'];

/** Write the given values, each checked against its declaration; then apply them. */
function save(values = {}) {
  const { loadPrefs, savePrefs } = require('./utils');
  const prefs = loadPrefs();
  for (const [p, v] of Object.entries(values || {})) {
    if (!EDITABLE.includes(p)) throw Object.assign(new Error(`${p} is not a log setting.`), { status: 400 });
    const spec = schema().leaf(p);
    const val = Number(v);
    if (schema().value(p, { [p.split('.')[0]]: { [p.split('.')[1]]: val } }) !== val)
      throw Object.assign(new Error(`${p}: a ${spec.type === 'integer' ? 'whole ' : ''}number from ${spec.min} to ${spec.max}.`), { status: 400 });
    const [top, leaf] = p.split('.');
    prefs[top] = { ...(prefs[top] || {}), [leaf]: val };
  }
  savePrefs(prefs);
  forget();
  return { removed: prune(), ...usage() };
}

function mount(app) {
  app.get('/api/logs/keep', (_req, res) => res.json(usage()));
  app.post('/api/logs/keep', (req, res) => {
    try { res.json(save(req.body?.values)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { limit, usage, prune, start, save, mount, EDITABLE, _forget: forget };

'use strict';

/**
 * Which outside harnesses can be summoned as workers, and how each is run (harness-teams/; asked 2026-10-12). A harness
 * is offered when its catalog row carries `team` — its own non-interactive form with its approvals off, its event stream
 * and the model flag, written there as data beside a link to the tool's documentation (harness/catalog.js) — and the
 * owner's `teams.outside.allow` lets it (empty: every one that has a `team` form). Nothing here runs anything.
 *
 *   team.args     argv after the command: '{task}' is the task (one argument, never parsed by a shell), '{model}' the
 *                 model flag pair (`team.model`) when a model was asked for, else nothing
 *   team.events   which event stream it writes (events.js)
 *   team.key      the environment variable its API key goes in and the provider address that key is DOCA's for
 *   team.signedIn argv that exits 0 when it is signed in by itself (a person's sign-in kept in its computer)
 *   team.uv       a Python package installed in the computer with uv instead of npm (mini-swe-agent)
 *   team.relay    its model is DOCA's own through the model relay (relay/computer.js): the computer's relay token in that
 *                 one process's environment, never a provider key
 *   team.env      fixed environment for the process (no secrets)
 *   team.optIn    offered only once switched on here (installed on the Harness tab, or named in teams.outside.allow)
 *   team.when     when it fits a task: the rule the Orchestrator's routing table reads (harness/coordinator.js)
 *
 * Each has a switch (asked 2026-10-16), `teams.outside.use.<id>`: never — not offered, refused; ask — used when the
 * person names it or says yes to the Orchestrator's offer (the default for one that is allowed); free — the
 * Orchestrator may start it itself when a task fits, still only in agents' computers, and says so. Moving one to free
 * asks for the password (auth/guarded.js); a person's own words in chat reach it as settings_propose {asked: true},
 * which leaves it a proposal whose Accept asks.
 *   team.output   the flag pair a trajectory file goes in ('{output}' in args); the worker keeps it as an attachment
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** Every catalog row with a team form. */
function all() {
  return require('../harness/catalog').KNOWN.filter(r => r.kind === 'cli' && r.cmd && r.team && Array.isArray(r.team.args)).concat(_extra);
}

const allowList = () => { try { return require('../settings-schema').value('teams.outside.allow') || []; } catch { return []; } };   // undeclared in an old schema

/**
 * Whether an opt-in row (`team.optIn`: mini-swe-agent) is switched on here: a person installed it on the hub from the
 * Harness tab, or the owner named it in teams.outside.allow. Off until then — the agent never installs it itself.
 * Installed means its command on PATH *is* that tool (review of 2026-10-16): `mini` is a common name, so a program
 * found by it counts only when its real path or its launcher names the package (`team.uv`: uv, pipx and a venv's
 * launcher all carry it — the tools folder, or the module the script imports). Read, never run.
 */
const _found = new Map();   // cmd → {at, yes}: PATH is walked at most every 30 s (the routing table asks on every step)
function isTheTool(file, pkg) {
  if (!pkg) return true;
  const fs = require('fs');
  const marks = [pkg, pkg.replace(/-/g, '_'), pkg.replace(/-/g, '')].map(m => m.toLowerCase());
  let real = file;
  try { real = fs.realpathSync(file); } catch { /* as found */ }
  if (marks.some(m => real.toLowerCase().includes(m))) return true;
  try {   // a launcher script (or uv's trampoline on Windows) names its package; the first 2 MB is plenty
    const fd = fs.openSync(real, 'r');
    try { const buf = Buffer.alloc(2 << 20); const n = fs.readSync(fd, buf, 0, buf.length, 0); const text = buf.subarray(0, n).toString('latin1').toLowerCase(); return marks.some(m => text.includes(m)); }
    finally { fs.closeSync(fd); }
  } catch { return false; }
}
function installedHere(r) {
  const k = _found.get(r.cmd);
  if (k && Date.now() - k.at < 30000) return k.yes;
  const at = require('../shell').which(r.cmd);
  const yes = !!at && isTheTool(at, r.team?.uv || null);
  _found.set(r.cmd, { at: Date.now(), yes });
  return yes;
}
const optedIn = r => allowList().map(String).includes(r.id) || installedHere(r);

const MODES = ['never', 'ask', 'free'];
/** The three states as the panel and the agent say them. */
const WORDS = { never: 'Never', ask: 'Ask me first', free: 'On its own' };
const useMap = () => { try { const v = require('../settings-schema').value('teams.outside.use'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

/**
 * Its switch: never | ask | free. A harness switched off is never; one set here is what it is set to; otherwise the
 * older rule says (teams.outside.allow; empty: all of them, an opt-in one once switched on): allowed is ask, else never.
 */
function mode(r) {
  if (require('../harness/harness-life').isDisabled(r.id)) return 'never';
  const set = useMap()[r.id];
  if (MODES.includes(set)) return set;
  const allow = new Set(allowList().map(String));
  return (r.team.optIn ? optedIn(r) : (!allow.size || allow.has(r.id))) ? 'ask' : 'never';
}

/** The ones that may be summoned: every switch but never. */
function offered() { return all().filter(r => mode(r) !== 'never'); }

/** The ones the Orchestrator may start itself (free). */
function free() { return all().filter(r => mode(r) === 'free'); }

/** A harness by id or label, among those offered. Throws a sentence that names what is offered. */
function find(want) {
  const w = String(want || '').trim().toLowerCase();
  const row = offered().find(r => r.id === w || r.label.toLowerCase() === w || r.cmd === w);
  if (row) return row;
  const named = all().find(r => r.id === w || r.label.toLowerCase() === w);
  const list = offered().map(r => `${r.id} (${r.label})`).join(', ') || 'none';
  if (named && useMap()[named.id] === 'never') throw bad(`${named.label} is set to "${WORDS.never}" here (Settings → Harnesses → CLI harnesses → On a team). Allowed now: ${list}.`, 403);
  if (named?.team?.optIn && !optedIn(named)) throw bad(`${named.label} is off here: a person switches it on by installing it on the Harness tab (or the owner lists "${named.id}" in teams.outside.allow). Allowed now: ${list}.`, 403);
  if (named) throw bad(`${named.label} is not allowed to be summoned here (the owner's teams.outside.allow). Allowed: ${list}.`, 403);
  throw bad(`No outside harness "${want}" that runs without a terminal. Harnesses that can work in a team: ${list}.`, 404);
}

/** The npm package its catalog installCmd installs, or null when it is installed some other way (not offered in a box). */
function npmPackage(row) {
  if (row.team?.npm) return row.team.npm;
  const m = /^npm install -g (\S+)$/.exec(String(row.installCmd || '').trim());
  return m ? m[1] : null;
}

/**
 * The argv after the command for one task. A model on a harness with no model flag is refused, never dropped silently;
 * one with `team.defaultModel` always gets its flag (mini-swe-agent: the relay's first model). `{output}` is the
 * `team.output` pair when the worker keeps a trajectory file (`output`), else nothing.
 */
function argv(row, { task, model = null, output = null } = {}) {
  if (model && !row.team.model) throw bad(`${row.label} takes its model from its own settings (it has no model flag); leave model out.`);
  if (model && !/^[\w.:/@-]{1,80}$/.test(String(model))) throw bad('A model id is letters, digits and . : / @ - _ (e.g. opus, gpt-5-codex).');
  const m = model || row.team.defaultModel || null;
  const pair = m ? row.team.model.map(x => x.replace('{model}', String(m))) : [];
  const out = output && row.team.output ? row.team.output.map(x => x.replace('{output}', String(output))) : [];
  return row.team.args.flatMap(a => (a === '{task}' ? [String(task)] : a === '{model}' ? pair : a === '{output}' ? out : [a]));
}

/**
 * The API key DOCA keeps for this harness's vendor — from DOCA's own providers (provider-keys.js), matched by the
 * provider's address — as `{env, value}` for the worker's process alone, or null. Never logged, never shown, never an
 * argument: the hub puts it in that one process's environment (box.js).
 */
function keyFor(row) {
  const want = row.team?.key;
  if (!want?.env || !want.host) return null;
  const providers = require('../provider-keys').all();
  for (const [id, p] of Object.entries(providers)) {
    let host = '';
    try { host = new URL(p.baseUrl).hostname; } catch { /* not an address */ }
    if (host !== want.host && id !== want.host.split('.')[1]) continue;
    const value = require('../utils').resolveEnvVars(p.apiKey || '');
    if (value && value !== 'none') return { env: want.env, value, provider: id };
  }
  return null;
}

/** A row a test adds (a stub CLI); never set by the product. */
const _extra = [];

module.exports = { MODES, WORDS, mode, free, all, offered, find, npmPackage, argv, keyFor, optedIn, _extra, _found };

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
 */
const _found = new Map();   // cmd → {at, yes}: PATH is walked at most every 30 s (the routing table asks on every step)
function installedHere(cmd) {
  const k = _found.get(cmd);
  if (k && Date.now() - k.at < 30000) return k.yes;
  const yes = !!require('../shell').which(cmd);
  _found.set(cmd, { at: Date.now(), yes });
  return yes;
}
const optedIn = r => allowList().map(String).includes(r.id) || installedHere(r.cmd);

/** The ones the owner lets be summoned (teams.outside.allow; empty: all of them, an opt-in one once switched on). */
function offered() {
  const set = new Set(allowList().map(String));
  const off = require('../harness/harness-life');
  return all().filter(r => (r.team.optIn ? optedIn(r) : (!set.size || set.has(r.id))) && !off.isDisabled(r.id));   // a switched-off harness is not summoned
}

/** A harness by id or label, among those offered. Throws a sentence that names what is offered. */
function find(want) {
  const w = String(want || '').trim().toLowerCase();
  const row = offered().find(r => r.id === w || r.label.toLowerCase() === w || r.cmd === w);
  if (row) return row;
  const named = all().find(r => r.id === w || r.label.toLowerCase() === w);
  const list = offered().map(r => `${r.id} (${r.label})`).join(', ') || 'none';
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

module.exports = { all, offered, find, npmPackage, argv, keyFor, optedIn, _extra, _found };

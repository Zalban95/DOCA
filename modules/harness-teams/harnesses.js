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
 */
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** Every catalog row with a team form. */
function all() {
  return require('../harness/catalog').KNOWN.filter(r => r.kind === 'cli' && r.cmd && r.team && Array.isArray(r.team.args)).concat(_extra);
}

/** The ones the owner lets be summoned (teams.outside.allow; empty: all of them). */
function offered() {
  let allow = [];
  try { allow = require('../settings-schema').value('teams.outside.allow') || []; } catch { /* undeclared in an old schema */ }
  const set = new Set(allow.map(String));
  const off = require('../harness/harness-life');
  return all().filter(r => (!set.size || set.has(r.id)) && !off.isDisabled(r.id));   // a switched-off harness is not summoned
}

/** A harness by id or label, among those offered. Throws a sentence that names what is offered. */
function find(want) {
  const w = String(want || '').trim().toLowerCase();
  const row = offered().find(r => r.id === w || r.label.toLowerCase() === w || r.cmd === w);
  if (row) return row;
  const named = all().find(r => r.id === w || r.label.toLowerCase() === w);
  const list = offered().map(r => `${r.id} (${r.label})`).join(', ') || 'none';
  if (named) throw bad(`${named.label} is not allowed to be summoned here (the owner's teams.outside.allow). Allowed: ${list}.`, 403);
  throw bad(`No outside harness "${want}" that runs without a terminal. Harnesses that can work in a team: ${list}.`, 404);
}

/** The npm package its catalog installCmd installs, or null when it is installed some other way (not offered in a box). */
function npmPackage(row) {
  if (row.team?.npm) return row.team.npm;
  const m = /^npm install -g (\S+)$/.exec(String(row.installCmd || '').trim());
  return m ? m[1] : null;
}

/** The argv after the command for one task. A model on a harness with no model flag is refused, never dropped silently. */
function argv(row, { task, model = null } = {}) {
  if (model && !row.team.model) throw bad(`${row.label} takes its model from its own settings (it has no model flag); leave model out.`);
  if (model && !/^[\w.:/@-]{1,80}$/.test(String(model))) throw bad('A model id is letters, digits and . : / @ - _ (e.g. opus, gpt-5-codex).');
  const pair = model ? row.team.model.map(x => x.replace('{model}', String(model))) : [];
  return row.team.args.flatMap(a => (a === '{task}' ? [String(task)] : a === '{model}' ? pair : [a]));
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

module.exports = { all, offered, find, npmPackage, argv, keyFor, _extra };

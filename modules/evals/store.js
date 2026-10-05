'use strict';

/**
 * Evaluation sets and their results (TODO H10.1). A set is JSON — `{ id, title, description, cases: [{ id, prompt,
 * mode?, checks: [...] }] }` (checks: check.js) — shipped in the repository's `evals/` (read-only, so a fresh install
 * has them) or written under DATA_DIR/evals/sets, where a file of the same id wins. Results are one JSON file per run
 * under DATA_DIR/evals/results/<set>/, the last 30 kept, so a run can be compared with the one before it.
 */
const fs = require('fs');
const path = require('path');

const SHIPPED = path.join(__dirname, '..', '..', 'evals');
const dir = (...p) => path.join(require('../store').DATA_DIR, 'evals', ...p);
const ID = /^[a-z0-9][\w-]{0,60}$/i;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function readDir(d, origin) {
  try { return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => ({ ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), origin })); }
  catch { return []; }
}

function list() {
  const byId = new Map();
  for (const s of [...readDir(SHIPPED, 'shipped'), ...readDir(dir('sets'), 'yours')]) if (s.id) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const get = id => list().find(s => s.id === id) || null;

/** A set checked for shape: an id, and cases each with an id, a prompt and at least one check. */
function validate(set) {
  if (!set || !ID.test(String(set.id || ''))) throw bad('A set needs an id: letters, digits, - and _.');
  if (!Array.isArray(set.cases) || !set.cases.length) throw bad('A set needs cases.');
  const seen = new Set();
  for (const c of set.cases) {
    if (!ID.test(String(c.id || '')) || seen.has(c.id)) throw bad(`Each case needs its own id (${JSON.stringify(c.id)}).`);
    seen.add(c.id);
    if (!String(c.prompt || '').trim()) throw bad(`Case ${c.id} has no prompt.`);
    if (!Array.isArray(c.checks) || !c.checks.length) throw bad(`Case ${c.id} has no checks.`);
    if (c.mode && !['agent', 'plan', 'ask', 'debug'].includes(c.mode)) throw bad(`Case ${c.id}: mode is agent, plan, ask or debug.`);
  }
  return { id: set.id, title: String(set.title || set.id), description: String(set.description || ''), cases: set.cases.map(c => ({ id: c.id, prompt: String(c.prompt), ...(c.mode ? { mode: c.mode } : {}), checks: c.checks })) };
}

function save(set) {
  const s = validate(set);
  fs.mkdirSync(dir('sets'), { recursive: true });
  fs.writeFileSync(dir('sets', `${s.id}.json`), JSON.stringify(s, null, 2));
  return { ...s, origin: 'yours' };
}

function remove(id) {
  if (!ID.test(id)) throw bad('No such set.', 404);
  const f = dir('sets', `${id}.json`);
  if (!fs.existsSync(f)) throw bad(get(id) ? 'A shipped set cannot be deleted.' : 'No such set.', get(id) ? 409 : 404);
  fs.rmSync(f);
}

function saveResult(r, base = dir()) {
  const d = path.join(base, 'results', r.set);
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, `${r.startedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
  for (const old of fs.readdirSync(d).sort().slice(0, -30)) fs.rmSync(path.join(d, old), { force: true });
  return file;
}

/** The newest results of a set, newest first. */
function results(setId, limit = 10) {
  if (!ID.test(setId)) return [];
  const d = dir('results', setId);
  try { return fs.readdirSync(d).sort().reverse().slice(0, limit).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))); }
  catch { return []; }
}

module.exports = { list, get, validate, save, remove, saveResult, results };

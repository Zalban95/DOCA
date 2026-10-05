'use strict';

/**
 * Recipes (docs/design/hive.md §2.3; TODO H3): what the agent got working once, kept so it runs again without
 * the thinking — a recorded, parameterised sequence of tool calls with checks, run by run.js without a model.
 *
 *   { id, title, description,                      when to reach for it: what the agent and the list show
 *     params: [{ name, description, default? }],   `{name}` in any step argument is replaced at run time
 *     steps:  [{ tool, args, check?, note? }],      check: { ok: true } (default) | { contains } | { matches }
 *     revision, by, createdAt, updatedAt, from? }   from: the conversation it was lifted from
 *
 * One JSON file per recipe under DOCA_DATA_DIR/recipes, so a recipe is a file a person can read, diff and
 * carry to another hive (a pack, H4). Fields added later need a read-side default here: there is no migration.
 */
const fs = require('fs');
const path = require('path');
const store = require('../store');

const SUB = 'recipes';
const MAX_STEPS = 60;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function normalize(input, existing = null) {
  const title = String(input.title || existing?.title || '').trim().slice(0, 120);
  if (!title) throw bad('A recipe needs a title.');
  const id = existing?.id || slug(input.id || title);
  if (!id) throw bad('A recipe needs a title made of letters or digits.');
  const params = (Array.isArray(input.params) ? input.params : existing?.params || []).map(p => ({
    name: slug(p.name).replace(/-/g, '_'), description: String(p.description || '').slice(0, 300),
    ...(p.default !== undefined ? { default: String(p.default) } : {}),
  })).filter(p => p.name);
  const steps = (Array.isArray(input.steps) ? input.steps : existing?.steps || []).slice(0, MAX_STEPS).map((s, i) => {
    const tool = String(s.tool || s.name || '').trim();
    if (!tool) throw bad(`Step ${i + 1} names no tool.`);
    const args = s.args && typeof s.args === 'object' && !Array.isArray(s.args) ? s.args : {};
    const check = s.check && typeof s.check === 'object' ? {
      ...(s.check.contains ? { contains: String(s.check.contains).slice(0, 500) } : {}),
      ...(s.check.matches ? { matches: String(s.check.matches).slice(0, 500) } : {}),
      ...(s.check.ok === false ? { ok: false } : {}),
    } : {};
    if (check.matches) { try { new RegExp(check.matches); } catch { throw bad(`Step ${i + 1}: "${check.matches}" is not a regular expression.`); } }
    return { tool, args, ...(Object.keys(check).length ? { check } : {}), ...(s.note ? { note: String(s.note).slice(0, 300) } : {}) };
  });
  if (!steps.length) throw bad('A recipe needs at least one step.');
  const now = new Date().toISOString();
  return { id, title, description: String(input.description ?? existing?.description ?? '').slice(0, 1000), params, steps,
    revision: (existing?.revision || 0) + 1, by: existing?.by || input.by || null, createdAt: existing?.createdAt || now, updatedAt: now,
    ...(input.from || existing?.from ? { from: input.from || existing.from } : {}) };
}

const file = id => path.join(store.dir(SUB), `${slug(id)}.json`);

function get(id) {
  try { const r = JSON.parse(fs.readFileSync(file(id), 'utf8')); return { params: [], steps: [], revision: 1, ...r }; } catch { return null; }
}

function list() {
  let names = [];
  try { names = fs.readdirSync(store.dir(SUB)).filter(n => n.endsWith('.json')); } catch { /* none yet */ }
  return names.map(n => get(n.slice(0, -5))).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Save a new recipe, or a new revision of one (`id` given and present); the previous revision is kept beside it. */
function save(input) {
  const existing = input.id ? get(input.id) : null;
  const r = normalize(input, existing);
  if (!existing && get(r.id)) throw bad(`A recipe "${r.id}" exists. Pass its id to revise it.`, 409);
  if (existing) fs.writeFileSync(path.join(store.dir(`${SUB}/previous`), `${r.id}.r${existing.revision}.json`), JSON.stringify(existing, null, 2));
  fs.writeFileSync(file(r.id), JSON.stringify(r, null, 2));
  return r;
}

/**
 * A proposed revision (the recipe-repair experiment, docs/experiments/recipe-repair.md): kept beside the recipe,
 * never run, until a person accepts it (it becomes the next revision) or discards it.
 */
const proposedFile = id => path.join(store.dir(`${SUB}/proposed`), `${slug(id)}.json`);
function proposed(id) { try { return JSON.parse(fs.readFileSync(proposedFile(id), 'utf8')); } catch { return null; } }
function propose(input) {
  const existing = get(input.id);
  if (!existing) throw bad(`No recipe "${input.id}" to propose a revision of.`, 404);
  const r = { ...normalize({ ...existing, ...input }, existing), proposedAt: new Date().toISOString(), why: String(input.why || '').slice(0, 1000) };
  fs.writeFileSync(proposedFile(r.id), JSON.stringify(r, null, 2));
  return r;
}
function accept(id) {
  const p = proposed(id);
  if (!p) throw bad(`No proposed revision of "${id}".`, 404);
  const { proposedAt, why, revision, createdAt, updatedAt, ...input } = p;
  const r = save({ ...input, id });
  fs.rmSync(proposedFile(id), { force: true });
  return r;
}
function discard(id) { if (!proposed(id)) throw bad(`No proposed revision of "${id}".`, 404); fs.rmSync(proposedFile(id), { force: true }); return { discarded: id }; }

function remove(id) {
  const r = get(id);
  if (!r) throw bad(`No recipe "${id}".`, 404);
  fs.rmSync(file(id), { force: true });
  return { removed: r.id };
}

/**
 * The tool calls of a conversation's last turn, as recipe steps: every call that did not fail, in order.
 * `params` [{name, value}] lifts the values that varied: each literal occurrence becomes `{name}`.
 */
function fromTurn(sessionId, { params = [] } = {}) {
  const rows = require('../harness/memory').messages(sessionId);
  // The last turn: after the last user row — or, when that row has no answer yet, after the one before it.
  let last = rows.map(r => r.role).lastIndexOf('user');
  if (last === rows.length - 1) last = rows.map(r => r.role).lastIndexOf('user', last - 1);
  const start = last + 1;
  const results = new Map(rows.slice(start).filter(r => r.role === 'tool').map(r => [r.tool_call_id, String(r.content || '')]));
  const steps = [];
  for (const r of rows.slice(start)) {
    for (const tc of r.role === 'assistant' ? r.tool_calls || [] : []) {
      const out = results.get(tc.id || tc.function?.name) ?? '';
      if (/^(Error|Refused|Not run)\b/.test(out)) continue;   // the dead ends stay behind
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { continue; }
      steps.push({ tool: tc.function?.name, args: lift(args, params) });
    }
  }
  if (!steps.length) throw bad('The last turn of that conversation made no tool call that worked, so there is nothing to keep.');
  return { steps, params: params.map(p => ({ name: p.name, description: p.description || '', default: String(p.value ?? '') })) };
}

function lift(value, params) {
  if (typeof value === 'string') return params.reduce((s, p) => (p.value ? s.split(String(p.value)).join(`{${p.name}}`) : s), value);
  if (Array.isArray(value)) return value.map(v => lift(v, params));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, lift(v, params)]));
  return value;
}

module.exports = { list, get, save, remove, fromTurn, normalize, slug, proposed, propose, accept, discard };

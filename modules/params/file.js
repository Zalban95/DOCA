'use strict';

/**
 * A project's parameters (parametric projects, phase 1; ~design: one file of values per project, a mask in the panel,
 * rebuilds without the thinking). `project.params.json` at the project's root, format 1:
 *
 *   { format: 1, title?, groups?: [{id, label}],
 *     params: { <name>: { type: number|integer|boolean|string|color, default, min?, max?, step?, unit?, oneOf?,
 *                         label?, hint?, group?, advanced?, lock? } },
 *     values: { <name>: value }      only what differs from the default (the mask writes it; agents write the rest)
 *     build:  [ stage ] }            params/build.js: recipes run with no model
 *
 * Declarations are the settings leaves' shape (settings-schema.js) with a label, a unit and a group, so the mask draws
 * them as Settings does. A name holding key, token, secret or password is refused: a secret is never a parameter
 * (harness/settings.js FORBIDDEN). Problems are reported, never thrown, so the mask can show a broken file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = 'project.params.json';
const TYPES = ['number', 'integer', 'boolean', 'string', 'color'];
const NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const where = root => path.join(root, NAME);

/** { exists, text, hash, doc, errors }: the file as it is, parsed and checked. */
function read(root) {
  let text;
  try { text = fs.readFileSync(where(root), 'utf8'); } catch { return { exists: false, errors: [] }; }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { exists: true, text, hash: sha(text), errors: [`${NAME} is not JSON: ${e.message}`] }; }
  return { exists: true, text, hash: sha(text), doc, errors: check(doc) };
}

/** What is wrong with a declaration file, in sentences (empty when nothing). */
function check(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${NAME} is an object.`];
  if (doc.format !== 1) errors.push(`format is 1 (it says ${JSON.stringify(doc.format)}).`);
  const params = doc.params && typeof doc.params === 'object' ? doc.params : null;
  if (!params) errors.push('params is an object of declared values.');
  const forbidden = require('../harness/settings').FORBIDDEN;
  for (const [name, d] of Object.entries(params || {})) {
    if (!NAME_RE.test(name)) { errors.push(`"${name}": a name is lowercase letters, digits and _, starting with a letter.`); continue; }
    if (name.split('_').some(seg => forbidden.test(seg))) { errors.push(`"${name}": a secret is never a parameter (keys stay with the hub).`); continue; }
    if (!d || !TYPES.includes(d.type)) { errors.push(`"${name}": type is one of ${TYPES.join(', ')}.`); continue; }
    const e = invalid(d, d.default, { declaring: true });
    if (e) errors.push(`"${name}" default: ${e}`);
  }
  for (const [name, v] of Object.entries(doc.values || {})) {
    if (!params?.[name]) { errors.push(`values.${name} is not declared in params.`); continue; }
    const e = invalid(params[name], v);
    if (e) errors.push(`values.${name}: ${e}`);
  }
  if (doc.build !== undefined && !Array.isArray(doc.build)) errors.push('build is a list of stages.');
  return errors;
}

/** Why `v` is not a value of declaration `d`, or null. */
function invalid(d, v, { declaring = false } = {}) {
  if (v === undefined) return declaring ? 'every parameter has a default.' : 'no value.';
  switch (d.type) {
    case 'boolean': return typeof v === 'boolean' ? null : 'true or false.';
    case 'color': return typeof v === 'string' && COLOR_RE.test(v) ? null : 'a colour like #4aa3ff.';
    case 'string':
      if (typeof v !== 'string') return 'text.';
      if (v.length > 500) return 'at most 500 characters.';
      return Array.isArray(d.oneOf) && !d.oneOf.includes(v) ? `one of ${d.oneOf.join(', ')}.` : null;
    default: {   // number, integer
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'a number.';
      if (d.type === 'integer' && !Number.isInteger(v)) return 'a whole number.';
      if (d.min != null && v < d.min) return `at least ${d.min}${d.unit ? ` ${d.unit}` : ''}.`;
      if (d.max != null && v > d.max) return `at most ${d.max}${d.unit ? ` ${d.unit}` : ''}.`;
      return null;
    }
  }
}

/** Every parameter's value now: its default, overlaid by `values`. */
function effective(doc) {
  const out = {};
  for (const [name, d] of Object.entries(doc?.params || {})) out[name] = doc.values && name in doc.values ? doc.values[name] : d.default;
  return out;
}

/** The declarations as the mask draws them: in their groups' order, each with its value now. */
function view(doc) {
  const vals = effective(doc);
  const groups = Array.isArray(doc?.groups) ? doc.groups.filter(g => g?.id).map(g => ({ id: String(g.id), label: String(g.label || g.id) })) : [];
  const params = Object.entries(doc?.params || {}).filter(([n, d]) => NAME_RE.test(n) && TYPES.includes(d?.type)).map(([name, d]) => ({
    name, type: d.type, label: d.label || name.replace(/_/g, ' '), hint: d.hint || '', unit: d.unit || '', group: d.group || '',
    min: d.min ?? null, max: d.max ?? null, step: d.step ?? null, oneOf: Array.isArray(d.oneOf) ? d.oneOf : null,
    advanced: !!d.advanced, lock: !!d.lock, default: d.default, value: vals[name], changed: !!(doc.values && name in doc.values),
  }));
  for (const g of new Set(params.map(p => p.group))) if (!groups.some(x => x.id === g)) groups.push({ id: g, label: g || 'Parameters' });
  return { title: doc?.title || '', groups, params };
}

/**
 * New values: checked against their declarations, then `values` rewritten to hold only what differs from each default
 * (catalog.saveConfig's rule: a better default reaches every copy). Returns { doc, changes: [{name, from, to}] }.
 */
function withValues(doc, given) {
  const vals = effective(doc), changes = [], errors = [];
  for (const [name, v] of Object.entries(given || {})) {
    const d = doc.params?.[name];
    if (!d) { errors.push(`${name} is not a parameter here.`); continue; }
    const e = invalid(d, v);
    if (e) { errors.push(`${d.label || name}: ${e}`); continue; }
    if (vals[name] !== v) changes.push({ name, from: vals[name], to: v });
  }
  if (errors.length) throw bad(errors.join(' '));
  const values = {};
  const next = { ...vals, ...Object.fromEntries(changes.map(c => [c.name, c.to])) };
  for (const [name, d] of Object.entries(doc.params || {})) if (next[name] !== d.default) values[name] = next[name];
  return { doc: { ...doc, values }, changes };
}

/** Write the file (two-space JSON, a trailing newline): the text and its hash. */
function write(root, doc) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  fs.writeFileSync(where(root), text);
  return { text, hash: sha(text) };
}

module.exports = { NAME, TYPES, where, read, check, invalid, effective, view, withValues, write, sha };

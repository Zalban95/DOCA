'use strict';

/**
 * Templates and the little arithmetic a build may use (parametric projects, phase 1). A template is a craft spec with
 * holes: `${name}` (a parameter), `${derived.name}` (a value the build itself wrote to build/derived.json), and a format
 * after a bar — `${tab_w|fixed:1}`, `${title|upper}`. A string that is exactly one hole keeps the value's type (a number
 * stays a number). Simple sums are allowed where a value is expected — `${bed}-5`, `(${tab_w}+2*${wall})/2` — read by a
 * parser that knows numbers, + − × ÷ and brackets and nothing else: never eval, never a general language.
 */
const HOLE = /\$\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)(?:\|([a-z]+)(?::(\d+))?)?\}/gi;
const ONE = /^\$\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)(?:\|([a-z]+)(?::(\d+))?)?\}$/i;

function lookup(vars, name) {
  if (name.startsWith('derived.')) return vars.derived ? vars.derived[name.slice(8)] : undefined;
  return vars[name];
}

function format(v, fmt, arg) {
  switch ((fmt || '').toLowerCase()) {
    case '': return v;
    case 'fixed': return Number(v).toFixed(Math.min(6, Number(arg ?? 2)));
    case 'int': return Math.round(Number(v));
    case 'upper': return String(v).toUpperCase();
    case 'lower': return String(v).toLowerCase();
    default: throw new Error(`"${fmt}" is not a format (fixed:N, int, upper, lower).`);
  }
}

/** One string: its holes filled. Unknown names are an error naming them. */
function fillString(s, vars) {
  const one = ONE.exec(s);
  if (one) {
    const v = lookup(vars, one[1]);
    if (v === undefined) throw new Error(`\${${one[1]}} names no parameter or derived value.`);
    return format(v, one[2], one[3]);
  }
  return s.replace(HOLE, (m, name, fmt, arg) => {
    const v = lookup(vars, name);
    if (v === undefined) throw new Error(`\${${name}} names no parameter or derived value.`);
    return String(format(v, fmt, arg));
  });
}

/** A whole template (any JSON value), resolved. */
function fill(value, vars) {
  if (typeof value === 'string') return fillString(value, vars);
  if (Array.isArray(value)) return value.map(v => fill(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

/** A number from a string that may hold holes and + − × ÷ and brackets; a plain value passes through. */
function number(expr, vars) {
  if (typeof expr === 'number') return expr;
  const s = String(fillString(String(expr), vars));
  if (!/^[\d\s.+\-*/()eE]+$/.test(s)) return Number.isFinite(Number(s)) ? Number(s) : NaN;
  let i = 0;
  const peek = () => { while (s[i] === ' ') i++; return s[i]; };
  const atom = () => {
    const c = peek();
    if (c === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error(`a bracket is not closed in "${expr}"`); i++; return v; }
    if (c === '-') { i++; return -atom(); }
    const m = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw new Error(`"${expr}" is not a sum of numbers`);
    i += m[0].length;
    return Number(m[0]);
  };
  const product = () => { let v = atom(); for (let c = peek(); c === '*' || c === '/'; c = peek()) { i++; v = c === '*' ? v * atom() : v / atom(); } return v; };
  const sum = () => { let v = product(); for (let c = peek(); c === '+' || c === '-'; c = peek()) { i++; v = c === '+' ? v + product() : v - product(); } return v; };
  const v = sum();
  if (peek() !== undefined) throw new Error(`"${expr}" has more after the sum`);
  return v;
}

/** Holes in a template: every name it reads (for what a stage depends on). */
function names(value, out = new Set()) {
  if (typeof value === 'string') for (const m of value.matchAll(HOLE)) out.add(m[1]);
  else if (Array.isArray(value)) value.forEach(v => names(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => names(v, out));
  return out;
}

module.exports = { fill, fillString, number, names };

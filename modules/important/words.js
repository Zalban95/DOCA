'use strict';

/**
 * An important change in words, from fixed tables (asked 2026-10-16: "the chat shows a red line with what changed,
 * mechanically"). No model writes any of it: a settings path is named from LABELS, a value is formatted by `show()`
 * (a secret-shaped one only as "changed", secrets-mask.js's rule), and a change that is not a setting is said from
 * ROUTE_WORDS with only the identifiers its address carries and the few body fields in SAFE — never a password, a key
 * or a secret's value.
 */
const { mask, MASK } = require('../secrets-mask');

/** Settings paths a person reads, the longest that matches first; what is left of the path follows it. */
const LABELS = [
  ['harness.approval.mode', 'Approval mode'],
  ['harness.approval.always', 'Always-allowed list'],
  ['harness.approval.manualAsks', 'What Manual asks'],
  ['harness.approval', 'Approvals'],
  ['teams.outside.use', 'Outside harnesses on their own'],
  ['agents.enabled', 'Specialists'],
  ['developer.releaseUnasked', 'Who may release unasked'],
  ['developer.mode', 'Developer mode'],
  ['developer', 'Developer'],
  ['experiments', 'Experiment'],
  ['sharing', 'Sharing with the project'],
  ['network.listen', 'How the hub listens'],
  ['network', 'Network'],
  ['cast.door', 'The cast door'],
  ['tracing', 'Traces kept'],
  ['logs', 'What is kept'],
  ['usagePrices', 'Prices for money budgets'],
  ['peopleModels', 'Which models people run on'],
];

/** The schema's own words for a leaf (settings-schema.js): its hint's first sentence, and its default. */
function leafOf(path) {
  try { return require('../settings-schema').leaf(path); } catch { return null; }
}
const hintOf = leaf => (leaf?.hint ? String(leaf.hint).split(/(?<=\.)\s/)[0].replace(/\.$/, '') : '');

function labelOf(path) {
  const hit = LABELS.find(([p]) => path === p || path.startsWith(`${p}.`));
  if (!hit) return path;
  const rest = path.slice(hit[0].length + 1);
  if (!rest) return hit[1];
  // A leaf no label names: said by its hint ("Traces kept — days a turn's trace is kept"), never by its raw key.
  const hint = hintOf(leafOf(path));
  return hint && hint.length <= 80 ? `${hit[1]} — ${hint.charAt(0).toLowerCase()}${hint.slice(1)}` : `${hit[1]} ${rest}`;
}

const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A value as a person reads it; a secret-shaped key's string is never shown. */
function show(value, key = '') {
  const v = mask(value, key);
  if (v === MASK) return 'a secret';
  if (v === undefined || v === null || v === '') return 'not set';
  if (v === true) return 'on';
  if (v === false) return 'off';
  if (Array.isArray(v)) return v.length ? clip(v.map(x => (typeof x === 'object' ? JSON.stringify(mask(x)) : String(x))).join(', '), 80) : 'none';
  if (typeof v === 'object') return clip(JSON.stringify(v), 80);
  return clip(String(v));
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plain = v => v && typeof v === 'object' && !Array.isArray(v);

/** Every leaf that differs between two values under `path`: [{path, from, to}]. */
function leaves(path, from, to, out = []) {
  if (same(from, to)) return out;
  if (plain(from) || plain(to)) {
    const keys = new Set([...Object.keys(plain(from) ? from : {}), ...Object.keys(plain(to) ? to : {})]);
    for (const k of keys) leaves(`${path}.${k}`, plain(from) ? from[k] : undefined, plain(to) ? to[k] : undefined, out);
    return out;
  }
  out.push({ path, from, to });
  return out;
}

/** One line per changed leaf: "Approval mode: auto → manual"; a secret-shaped leaf only as "changed". */
function line({ path, from, to }) {
  const key = path.split('.').pop();
  if (mask('x', key) === MASK) return `${labelOf(path)}: changed (a secret, not shown)`;
  const dflt = leafOf(path)?.default;   // "not set" is the default in effect: said as that value
  const was = (from === undefined || from === null) && dflt !== undefined && dflt !== '' && dflt !== null ? `${show(dflt, key)} (the default)` : show(from, key);
  const now = (to === undefined || to === null) && dflt !== undefined && dflt !== '' && dflt !== null ? `${show(dflt, key)} (the default)` : show(to, key);
  return `${labelOf(path)}: ${was} → ${now}`;
}

/** The changes under the guarded settings paths between two copies of the prefs. */
function prefsLines(before, after, paths) {
  const get = (o, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
  const out = [];
  for (const p of paths) for (const c of leaves(p, get(before, p), get(after, p))) if (!out.some(o => o.path === c.path)) out.push(c);
  return out.map(line);
}

/** Body fields that may be said: names, modes and switches — never a value someone typed as a secret. */
const SAFE = ['version', 'mode', 'on', 'enabled', 'action', 'level', 'name', 'permission', 'scope', 'test', 'suspended', 'role'];
const safeBody = body => SAFE.filter(k => body && body[k] !== undefined && typeof body[k] !== 'object').map(k => `${k} ${show(body[k], k)}`);

const VERB = { POST: 'changed', PUT: 'changed', PATCH: 'changed', DELETE: 'removed' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** What a request to a guarded route that is not a setting did, from its address, method and safe body fields. */
function routeLine(sw, req) {
  const p = req.path;
  const id = decodeURIComponent((/\/api\/[^?]*\/([^/]+)$/.exec(p) || [])[1] || '');
  const hit = ROUTE_WORDS.find(([re]) => re.test(p));
  if (hit) return hit[1](req, id);
  const extra = safeBody(req.body);
  return `${cap(sw.what)}: ${VERB[req.method] || 'changed'}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

/** Routes whose own words say more than the switch's name. */
const ROUTE_WORDS = [
  [/^\/api\/restart$/, () => 'The hub: restart asked'],
  [/^\/api\/versions\/use$/, req => `Which version runs: switching to ${show(req.body?.version)}`],
  [/^\/api\/update/, () => 'Which version runs: an update asked'],
  [/^\/api\/experiments\//, (req, id) => `Experiment ${id}: ${req.body?.on === false || req.body?.enabled === false ? 'off' : 'on'}`],
  [/^\/api\/harness\/approval\/always\//, (req, id) => `Always-allowed list: removed ${clip(id)}`],
  [/^\/api\/harness\/sessions\/[^/]+\/settings$/, req => `A conversation's approval switch: ${show(req.body?.approval ?? 'the panel\'s')}`],
  [/^\/api\/settings\/checkpoints\/[^/]+\/restore$/, () => 'Settings: a checkpoint restored'],
  [/^\/api\/backups\/[^/]+\/restore$/, () => 'A backup restored (settings and keys)'],
  [/^\/api\/packs\//, () => 'A pack brought in'],
  [/^\/api\/connectors\/sealed\//, (req, id) => `Secrets for devices: ${req.method === 'DELETE' ? 'forgot' : 'kept'} ${req.body?.name ? show(req.body.name) : id ? clip(id) : 'one'} (its value is never shown)`],
  [/^\/api\/harness\/guards/, (req, id) => `The guards: ${req.method === 'DELETE' ? 'removed' : 'changed'}${id && id !== 'guards' ? ` ${clip(id)}` : ''}${req.body?.enabled !== undefined ? ` (${req.body.enabled ? 'on' : 'off'})` : ''}`],
  [/^\/api\/auth\/users\/[^/]+\/password$/, () => 'Another person\'s password: reset'],
];

module.exports = { LABELS, labelOf, show, leaves, line, prefsLines, routeLine, safeBody, cap };

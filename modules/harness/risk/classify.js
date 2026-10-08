'use strict';

/**
 * A tool call's risk tier, from the table in rules.js (experiment riskTiers; TODO H10.11):
 *
 *   classify(name, args, { root, cwd, mcp }) → { tier: 'read'|'reversible'|'outward', why, way, touches }
 *
 * `root` is the project folder the conversation is bound to (a delete inside it is reversible: a checkpoint covers it),
 * `cwd` where a shell line runs, `mcp` the tool's MCP annotations when it is one ({readOnly, destructive, openWorld}).
 * Pure: no file, no process, no setting is read here, so the measurement and the tests call it as it is.
 */
const path = require('path');
const R = require('./rules');

const RANK = { read: 0, reversible: 1, outward: 2 };
const worse = (a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a);

function matches(want, value) {
  if (typeof want === 'function') return !!want(value);
  if (want instanceof RegExp) return want.test(String(value ?? ''));
  if (Array.isArray(want)) return want.includes(value);
  return want === value;
}

function fromRows(rows, args) {
  const row = rows.find(r => !r.when || Object.entries(r.when).every(([k, v]) => matches(v, args?.[k])));
  return row ? { tier: row.tier, why: row.why || null, way: row.tier === 'reversible' ? (row.way || R.WAY.none) : null, touches: !!row.touches } : null;
}

/** The segments of a command line, as `{ text, verb }` — a verb behind env assignments and sudo. */
function segments(command) {
  return String(command || '')
    .replace(/\d*>&\d+|&>{1,2}\s*\/dev\/null/g, ' ')
    .replace(/\$\(|`|\)/g, ';')                                     // what a substitution runs is a segment of its own
    .split(/\s*(?:&&|\|\||[;|&\n])\s*/)
    .map(s => s.trim()).filter(Boolean)
    .map(s => {
      const words = s.split(/\s+/);
      let i = 0;
      // A verb behind env assignments, sudo, or a word that runs the next one (xargs rm, nohup, timeout 10 …).
      while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || /^(sudo|doas|xargs|nohup|nice|time|exec|command|timeout)$/.test(words[i])
        || (i > 0 && /^(xargs|timeout|nice)$/.test(words[i - 1]) && /^(-\S*|\d+\w?)$/.test(words[i])))) i++;
      const rest = words.slice(i);
      return { text: rest.join(' '), verb: (rest[0] || '').replace(/^["']|["']$/g, '').replace(/^.*[\\/]/, ''), words: rest };
    })
    .filter(s => s.verb);
}

/** Whether a path the line names is inside the project (relative paths from where the line runs). */
function inside(target, { root, cwd }) {
  if (!root) return false;
  const t = String(target).replace(/^["']|["']$/g, '');
  if (/^~|\$|%/.test(t)) return false;                                 // home or a variable: cannot be placed
  const abs = path.resolve(cwd || root, t);
  const rel = path.relative(path.resolve(root), abs);
  return rel === '' ? false : !rel.startsWith('..') && !path.isAbsolute(rel);   // the project folder itself is not "inside" it
}

/** Whether the line runs in the project (its folder or below). */
const within = ({ root, cwd }) => !!root && (!cwd || path.resolve(cwd) === path.resolve(root) || inside(cwd, { root }));

/** `ssh host <command>`: the command runs on that machine — outward when it changes anything on one the owner does not own. */
function remote(words) {
  let i = 1;
  while (i < words.length && /^-/.test(words[i])) i += /^-[bcDEeFIiJLlmOopQRSWw]$/.test(words[i]) ? 2 : 1;   // flags that take a value
  const host = (words[i] || '').replace(/^[^@]*@/, '');
  const command = words.slice(i + 1).join(' ').replace(/^["']|["']$/g, '');
  if (!host || !command) return null;
  const r = shell(command, { root: null, cwd: null });
  if (r.tier === 'outward') return { tier: 'outward', why: `on ${host}: ${r.why}` };
  if (r.tier === 'reversible' && !require('../toolbox/http').owned(`ssh://${host}`)) return { tier: 'outward', why: 'changes something on a machine the owner does not own' };
  return r.tier === 'reversible' ? { tier: 'reversible', way: `on ${host}; DOCA takes no checkpoint there` } : { tier: 'read' };
}

function shellSegment(seg, where) {
  const { text, verb, words } = seg;
  for (const o of R.SHELL_OUTWARD) if (o.re.test(text)) return { tier: 'outward', why: o.why };
  if (R.DELETE_VERBS.test(verb)) {
    const targets = words.slice(1).filter(w => !/^-/.test(w));
    // No target named (`… | xargs rm`): what it deletes comes from where the line runs.
    if (targets.length ? targets.every(t => inside(t, where)) : within(where)) return { tier: 'reversible', way: R.WAY.project, touches: true };
    return { tier: 'outward', why: where.root ? 'deletes files outside the project' : 'deletes files outside any project' };
  }
  if (/^find$/.test(verb) && /\s-delete\b|\s-exec\s+rm\b/.test(text)) {
    const start = words[1] && !/^-/.test(words[1]) ? words[1] : '.';
    return inside(start, where) || (start === '.' && within(where))
      ? { tier: 'reversible', way: R.WAY.project, touches: true } : { tier: 'outward', why: 'deletes files outside a project (find -delete)' };
  }
  if (R.LOSES_WORK.test(text))
    return within(where)
      ? { tier: 'reversible', way: R.WAY.project, touches: true } : { tier: 'outward', why: 'throws away uncommitted work outside a project' };
  if (R.REQUEST_VERBS.test(verb) && R.SENDS.test(` ${words.slice(1).join(' ')}`)) {
    const urls = text.match(/https?:\/\/[^\s'"]+/g) || [];
    if (!urls.length || urls.some(u => !require('../toolbox/http').owned(u))) return { tier: 'outward', why: 'sends data to an address the owner does not own' };
    return { tier: 'reversible', way: 'a request to an address the owner owns' };
  }
  if (verb === 'ssh') { const r = remote(words); if (r) return r; }
  if (/^(scp|rsync|sftp)$/.test(verb)) {
    const remote = words.slice(1).map(w => /^(?:[^@\s/]+@)?([^:\s/]+):/.exec(w)?.[1]).filter(Boolean);
    if (remote.some(h => !require('../toolbox/http').owned(`ssh://${h}`))) return { tier: 'outward', why: 'copies files to a machine the owner does not own' };
  }
  if (R.READ_VERBS.has(verb) || (R.READ_IF[verb] && R.READ_IF[verb](text))) return { tier: 'read' };
  return { tier: 'reversible', way: where.root ? R.WAY.project : R.WAY.none, touches: true };
}

function shell(command, where) {
  const segs = segments(command);
  if (!segs.length) return { tier: 'read', why: null, way: null, touches: false };
  let out = { tier: 'read' };
  for (const seg of segs) out = worse(out, shellSegment(seg, where));
  // A line DOCA cannot reduce to verbs (a substitution, a redirect into a file): never a read.
  const computed = require('../approval').verbsOf(command) === null;
  if (computed && out.tier === 'read') out = { tier: 'reversible', way: `${where.root ? R.WAY.project : R.WAY.none} (a line DOCA cannot reduce to verbs)`, touches: true };
  return { tier: out.tier, why: out.why || null, way: out.tier === 'reversible' ? out.way : null, touches: !!out.touches };
}

function classify(name, args = {}, where = {}) {
  args = args && typeof args === 'object' ? args : {};
  if (name === 'shell') return shell(args.command, { root: where.root || null, cwd: args.cwd ? path.resolve(where.root || '.', args.cwd) : (where.cwd || where.root || null) });
  if (/^mcp__/.test(name)) return mcp(name, args, where.mcp);
  if (/^connector_/.test(name)) return fromRows(R.CONNECTOR, args);
  if (name === 'service') return fromRows(R.TOOLS.service, serviceArgs(args));
  if (R.TOOLS[name]) return fromRows(R.TOOLS[name], args);
  try {
    if (require('../approval').FREE.has(name) || require('../tools').isRead(name, args)) return { tier: 'read', why: null, way: null, touches: false };
  } catch { /* the table alone */ }
  return { tier: 'reversible', why: null, way: R.WAY.none, touches: false };
}

/**
 * A `service` call said as the table reads it: what it does, and the action's method and address from the service's own
 * definition (the one read this module makes — a definition is the owner's, and the call names only the action). An
 * action it cannot find reads as a POST to the service, so it is never taken for less than it may be.
 */
function serviceArgs(args) {
  const does = args.action || (args.operation ? 'call' : args.service ? 'describe' : 'list');
  if (does !== 'call') return { _do: does };
  let def = null;
  try { def = require('../../api-services/store').get(args.service); } catch { /* no definitions: as a POST */ }
  const a = def?.actions.find(x => x.name === args.operation);
  return { _do: does, _method: args.follow ? 'GET' : a?.method || 'POST', _url: `${def?.server || 'https://unknown.invalid'}${a?.path || ''}` };
}

/** An MCP tool: an agents' computer is disposable; any other by the server's annotations, else by the tool's name. */
function mcp(name, args, ann = {}) {
  const tool = name.split('__').pop();
  if (args.confirm === true) return { tier: 'outward', why: 'the device marks it a decision (confirm: true)', way: null, touches: false };
  if (/^mcp__computer-/.test(name)) return { tier: ann?.readOnly ? 'read' : 'reversible', why: null, way: ann?.readOnly ? null : R.WAY.computer, touches: false };
  if (ann?.readOnly) return { tier: 'read', why: null, way: null, touches: false };
  if (ann?.destructive) return { tier: 'outward', why: 'the server marks this tool destructive', way: null, touches: false };
  if (ann?.openWorld) return { tier: 'outward', why: 'the server says this tool reaches the open world', way: null, touches: false };
  if (R.MCP_OUTWARD_NAME.test(tool)) return { tier: 'outward', why: `a tool named for something nobody takes back (${tool})`, way: null, touches: false };
  return { tier: 'reversible', why: null, way: 'on that server\'s machine; DOCA takes no checkpoint there', touches: false };
}

module.exports = { classify, segments, inside, RANK };

'use strict';

/**
 * What a tool call does, said mechanically for an approval card (the owner, 2026-10-09: "show what they mean to do with
 * that request and what it does"). Never model-written: a fixed sentence per tool from its arguments, the risk table
 * (risk/classify.js) and the records the call names — a device, a computer, a key — so the card cannot be talked into
 * saying something milder than what runs. The agent's own words sit beside it, labelled as the agent's
 * (approval-explain.js).
 *
 *   does(name, args, { sessionId }) → "Runs a command on this machine (hub-1): deletes 3 paths (a, b, c)."
 *   way(name, args, { sessionId })  → "Can be undone: …" | "Cannot be undone: …" | "Only reads." | null
 */
const os = require('os');
const path = require('path');

const q = s => `"${String(s).length > 60 ? `${String(s).slice(0, 60)}…` : String(s)}"`;
const home = p => { const h = os.homedir(); const s = String(p || ''); return h && s.startsWith(h) ? `~${s.slice(h.length)}` : s; };
const list = (xs, n = 3) => `${xs.slice(0, n).map(home).join(', ')}${xs.length > n ? `, and ${xs.length - n} more` : ''}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const product = () => { try { return require('../branding').name('product'); } catch { return 'DOCA'; } };
const hostOf = u => { try { return new URL(String(u)).host; } catch { return ''; } };

/** One segment of a shell line, as a phrase: "deletes 2 paths (a, b)", "pushes to origin", "runs npm test". */
function segment({ verb, words, text }) {
  const R = require('./risk/rules');
  const rest = words.slice(1), targets = rest.filter(w => !/^-/.test(w));
  if (R.DELETE_VERBS.test(verb)) return targets.length ? `deletes ${plural(targets.length, 'path')} (${list(targets)})` : 'deletes what it is given';
  if (R.LOSES_WORK.test(text)) return 'throws away uncommitted work in a repository';
  if (verb === 'find' && /\s-delete\b|\s-exec\s+rm\b/.test(text)) return `deletes the files find matches under ${home(targets[0] || '.')}`;
  if (verb === 'git') {
    const sub = targets[0] || '';
    if (sub === 'push') return `pushes to ${targets[1] || 'the remote'}${/\s(--force(-with-lease)?|-f)\b/.test(text) ? ', forcing (rewrites history there)' : ''}`;
    if (sub === 'commit') return 'records a commit';
    if (sub === 'clone') return `clones ${targets[1] ? q(targets[1]) : 'a repository'}`;
    if (R.READ_IF.git(text)) return `reads the repository (git ${sub})`;
    return `runs git ${sub}`;
  }
  if (/^(mv|Move-Item)$/i.test(verb)) return `moves ${list(targets.slice(0, -1))} to ${home(targets.at(-1) || '')}`;
  if (/^(cp|Copy-Item)$/i.test(verb)) return `copies ${list(targets.slice(0, -1))} to ${home(targets.at(-1) || '')}`;
  if (/^(mkdir|New-Item)$/i.test(verb)) return `makes ${list(targets)}`;
  if (/^(chmod|chown)$/.test(verb)) return `changes who may use ${list(targets.slice(1))}`;
  if (/^(npm|yarn|pnpm|pip|pip3|uv|cargo|gem)$/.test(verb) && /^(i|install|add)$/.test(targets[0] || '')) return `installs packages with ${verb}${targets.length > 1 ? ` (${list(targets.slice(1))})` : ''}`;
  if (/^(curl|wget)$/.test(verb)) {
    const host = hostOf((text.match(/https?:\/\/[^\s'"]+/) || [])[0]);
    return R.SENDS.test(` ${rest.join(' ')}`) ? `sends data to ${host || 'an address'}` : `fetches from ${host || 'an address'}`;
  }
  if (/^(cd|pushd|Set-Location)$/i.test(verb)) return `goes into ${home(targets[0] || '~')}`;
  if (verb === 'ssh') return `runs a command on ${(targets[0] || 'another machine').replace(/^[^@]*@/, '')}`;
  if (R.READ_VERBS.has(verb) || R.READ_IF[verb]?.(text)) return `reads (${verb})`;
  return `runs ${[verb, ...targets.slice(0, 1)].join(' ')}`;
}

function shell(args, ctx) {
  const command = String(args.command || '');
  const segs = require('./risk/classify').segments(command);
  const computed = require('./approval').verbsOf(command) === null;
  const where = args.cwd ? ` in ${home(args.cwd)}` : ctx.root ? ` in the project folder ${home(ctx.root)}` : '';
  const sudo = /(^|[\s;&|])(sudo|doas)\s/.test(command) ? ' as administrator' : '';
  const head = `Runs a command on this machine (${os.hostname()})${where}${sudo}`;
  const parts = [...new Set(segs.map(segment))];
  const said = parts.length ? `${head}: ${parts.join('; then ')}` : head;
  return computed ? `${said}. Part of it is built while it runs ($(…), backticks or a redirect into a file), so ${product()} cannot read in advance everything it will do.`
    : `${said}${args.background ? ', in the background' : ''}.`;
}

/** The last snapshot of that page names [ref]: its kind and label, read from the transcript (the page's words, quoted). */
function element(sessionId, server, ref) {
  try {
    const rows = require('./memory').messages(sessionId) || [];
    const shot = [...rows].reverse().find(r => r.role === 'tool' && String(r.name || '').startsWith(`mcp__${server}__`) && /browser_snapshot$/.test(r.name));
    const m = shot && new RegExp(`^\\s*\\[${Number(ref)}\\]\\s+(\\S+)\\s+"([^"\\n]*)"`, 'm').exec(String(shot.content || ''));
    return m ? { kind: m[1].split(/[:[]/)[0], label: m[2] } : null;
  } catch { return null; }
}

/** Where an MCP tool runs, named from records: "the computer tester-1", "Al's phone", "this machine (hub-1)". */
function machineOf(name) {
  let s = null;
  try { s = require('../auth/reach').serverOf(name); } catch { /* unknown */ }
  const id = s?.server || String(name).split('__')[1] || '';
  if (s?.kind === 'computer' || /^computer-/.test(id)) {
    let c = null;
    try { c = require('../computers').get(id.replace(/^computer-/, '')); } catch { /* gone */ }
    return { where: `the computer ${q(c?.name || id)}`, server: id, computer: true };
  }
  if (s?.kind === 'device') {
    let d = null;
    try { d = require('../api-v1/devices').get(s.deviceId); } catch { /* gone */ }
    return { where: `the device ${q(d?.name || id)} (another machine)`, server: id };
  }
  return { where: `this machine (${os.hostname()}), through the MCP server ${q(id)}`, server: id };
}

function mcp(name, args, ctx) {
  const m = machineOf(name), tool = name.split('__').pop();
  const decision = args.confirm === true ? ' — marked a decision (it may pay, sign in, submit or confirm), so it is always asked' : '';
  if (/^browser_(click|type)$/.test(tool)) {
    const el = element(ctx.sessionId, m.server, args.ref);
    const what = el ? `${el.label ? q(el.label) : `element [${args.ref}]`}${el.kind ? ` (${el.kind})` : ''}` : `element [${args.ref}]`;
    const verb = tool === 'browser_click' ? `Clicks ${what}` : `Types ${plural(String(args.text || '').length, 'character')} into ${what}${args.submit ? ' and submits the form' : ''}`;
    return `${verb} in the browser on ${m.where}${decision}.`;
  }
  if (tool === 'browser_open') return `Opens ${hostOf(args.url) || 'a page'} in the browser on ${m.where}.`;
  const names = Object.keys(args || {}).filter(k => k !== 'confirm');
  return `Calls ${tool} on ${m.where}${names.length ? ` with ${names.join(', ')}` : ''}${decision}.`;
}

/** What a key named on a call is, from its record (never the key): "your key "hi3d"". */
const keyNamed = k => (k ? ` with your key ${q(k)}` : '');

const TABLE = {
  shell,
  write_file: (a, ctx) => {
    let exists = false;
    const p = String(a.path || ''), base = path.isAbsolute(p) ? '' : ctx.root;   // a relative path with no project: not looked up
    try { exists = (path.isAbsolute(p) || !!base) && require('fs').existsSync(path.resolve(base || '/', p)); } catch { /* unknown */ }
    return `${exists ? 'Replaces' : 'Creates'} the file ${home(a.path)} on this machine (${plural(String(a.content || '').split('\n').length, 'line')})${exists ? '; the old version is kept as a backup' : ''}.`;
  },
  read_file: a => `Reads the file ${home(a.path)} on this machine.`,
  api_call: a => `Sends a ${String(a.method || (a.form || a.files ? 'POST' : 'GET')).toUpperCase()} request to ${hostOf(a.url) || 'an address'}${keyNamed(a.key)}`
    + `${a.files ? `, uploading ${plural(Object.keys(a.files).length, 'file')}` : ''}${a.save_as ? `, keeping the answer as ${q(a.save_as)}` : ''}.`,
  http_fetch: a => `Reads the page ${hostOf(a.url) || String(a.url || '')} from the web.`,
  service: a => {
    const does = a.action || (a.operation ? 'call' : a.service ? 'describe' : 'list');
    if (does !== 'call') return `Looks at the API services set up here (${does}).`;
    return `Calls ${q(a.operation || 'an action')} of the service ${q(a.service || '?')} with the key kept for it${a.files ? `, uploading ${plural(Object.keys(a.files).length, 'file')}` : ''}.`;
  },
  settings_propose: a => {
    const c = Array.isArray(a.changes) ? a.changes : [];
    const first = c[0] ? `${c[0].path} to ${JSON.stringify(c[0].value)}`.slice(0, 120) : 'a setting';
    return `${a.asked ? 'Changes' : 'Proposes changing'} ${first}${c.length > 1 ? `, and ${c.length - 1} more` : ''}${a.screen ? ' on one screen' : ''}.`;
  },
  git: a => `Runs git ${a.action || ''} in ${home(a.path || a.repo || 'the project')}${a.message ? `, message ${q(a.message)}` : ''}.`,
  computer: a => `${String(a.action || 'manages').replace(/^\w/, x => x.toUpperCase())} an agents' computer${a.name ? ` ${q(a.name)}` : a.id ? ` ${q(a.id)}` : ''}.`,
  vnc_input: a => `${a.action === 'type' ? `Types ${plural(String(a.text || '').length, 'character')}` : `Sends ${a.action || 'input'}${a.keys ? ` (${a.keys})` : a.x != null ? ` at ${a.x},${a.y}` : ''}`} on the VNC screen ${q(a.target || '?')}.`,
  memory_forget: a => `Forgets the memory entry ${q(a.key || '?')}.`,
  tell_device: a => `Sends a notice${a.title ? ` ${q(a.title)}` : ''} to the person's own devices${a.files ? ` with ${plural(a.files.length || 0, 'file')}` : ''}.`,
};

function lead(name) {
  const leads = require('./turn/tool-leads').LEADS;
  if (leads[name]) return leads[name].split(' — ')[0];
  try {
    const d = (require('./tools').schemas([]).find(s => s.function?.name === name)?.function?.description || '');
    return d.split(/(?<=\.)\s/)[0].replace(/\.$/, '').slice(0, 140);
  } catch { return ''; }
}

function does(name, args = {}, ctx = {}) {
  args = args && typeof args === 'object' ? args : {};
  let root = null;
  try { root = require('./risk').projectOf(ctx.sessionId)?.root || null; } catch { /* no project */ }
  const c = { ...ctx, root };
  try {
    if (TABLE[name]) return TABLE[name](args, c);
    if (/^mcp__/.test(name)) return mcp(name, args, c);
  } catch { /* the generic line */ }
  const l = lead(name), names = Object.keys(args);
  return `Uses ${name}${l ? ` (${l})` : ''}${names.length ? ` with ${names.join(', ')}` : ''}.`;
}

/** Whether it can be undone, from the risk table (read whether or not the riskTiers experiment is on). */
function way(name, args = {}, ctx = {}) {
  let r = null;
  try { r = require('./risk').of(name, args, { sessionId: ctx.sessionId }); } catch { return null; }
  if (!r) return null;
  if (r.tier === 'read') return 'Only reads; changes nothing.';
  if (r.tier === 'outward') return `No way back once it runs: ${r.why || 'it reaches outside this machine'}.`;
  const R = require('./risk/rules');
  if (!r.way || r.way === R.WAY.none) return 'No automatic way back.';
  return /no checkpoint|^none\b/.test(r.way) ? `No automatic way back: ${r.way}.` : `Can be undone: ${r.way}.`;
}

module.exports = { does, way, segment, machineOf };

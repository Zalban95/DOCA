'use strict';

/**
 * Codex CLI's own session records (index.js): `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (CODEX_HOME moves the
 * folder). A line is `{timestamp, type, payload}` — `session_meta` names the session and its folder, `turn_context` the
 * folder a turn works in, and a `response_item` whose payload is a `function_call`, a `custom_tool_call` or a
 * `local_shell_call` is a step; older records wrote the payload as the line itself. Only the call is read: a shell
 * command, the files an apply_patch adds, changes or deletes, else the tool's name — never the conversation, the
 * reasoning or a call's output. Codex's format changes: what is not shaped as expected is skipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const id = 'codex', label = 'Codex';

const roots = () => [path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')];
const files = find => roots().flatMap(r => find(r, { match: f => /rollout-.*\.jsonl$/.test(f), depth: 3 }));

const SHELLS = new Set(['shell', 'container.exec', 'local_shell', 'exec_command', 'shell_command', 'bash']);

/** A command given as an argv (`["bash", "-lc", "npm test"]`) or a line, as a line. */
function lineOf(cmd) {
  if (typeof cmd === 'string') return cmd;
  if (!Array.isArray(cmd) || !cmd.every(x => typeof x === 'string')) return null;
  if (cmd.length >= 3 && /(^|\/)(ba|z)?sh$/.test(cmd[0]) && /^-l?c$/.test(cmd[1])) return cmd.slice(2).join(' ');
  return cmd.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/** The files a patch in apply_patch's own format touches. */
function patchFiles(text) {
  return [...String(text || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1].trim()).slice(0, 20);
}

/** One record line, with the file's own state (`meta`: its session and folder so far): its steps, or none. */
function parse(line, meta = {}) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (!o || typeof o !== 'object') return [];
  const p = o.payload && typeof o.payload === 'object' ? o.payload : o;
  if (o.type === 'session_meta') { if (p.id) meta.session = String(p.id); if (typeof p.cwd === 'string') meta.cwd = p.cwd; return []; }
  if (o.type === 'turn_context') { if (typeof p.cwd === 'string') meta.cwd = p.cwd; return []; }
  const at = Date.parse(o.timestamp) || Date.now();
  const step = { agent: id, label, session: meta.session || '', cwd: meta.cwd || null, at, callId: String(p.call_id || p.id || '') };
  if (p.type === 'local_shell_call') {
    const command = lineOf(p.action?.command);
    return command ? [{ ...step, tool: 'local_shell', kind: 'command', command }] : [];
  }
  if (p.type !== 'function_call' && p.type !== 'custom_tool_call') return [];
  const name = String(p.name || 'tool').slice(0, 80);
  let args = {};
  if (p.type === 'function_call') { try { args = JSON.parse(p.arguments || '{}') || {}; } catch { args = {}; } }
  if (name === 'update_plan' && Array.isArray(args.plan)) return [{ ...step, tool: name, kind: 'plan', todos: args.plan.map(s => String(s?.status || '')) }];   // its own plan (sessions.js)
  if (name === 'apply_patch') {
    const list = patchFiles(p.type === 'custom_tool_call' ? p.input : args.input || args.patch);
    return [{ ...step, tool: name, kind: list.length ? 'edit' : 'tool', ...(list.length ? { files: list } : {}) }];
  }
  if (SHELLS.has(name)) {
    const command = lineOf(args.command ?? args.cmd);
    if (command) return [{ ...step, tool: name, kind: 'command', command, ...(typeof args.workdir === 'string' ? { cwd: args.workdir } : {}) }];
  }
  return [{ ...step, tool: name, kind: 'tool' }];
}

/**
 * A record joined mid-way (a session resumed) has its session and folder only on its first line: read that line alone
 * (at most HEAD bytes) into `meta`. The file name carries the session's id too.
 */
const HEAD = 256 * 1024;
function head(file, meta) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file);
  if (m && !meta.session) meta.session = m[1];
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const buf = Buffer.alloc(HEAD), n = fs.readSync(fd, buf, 0, HEAD, 0), end = buf.subarray(0, n).indexOf(0x0a);
    if (end > 0) parse(buf.subarray(0, end).toString('utf8'), meta);
  } catch { /* the name's id will do */ } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* closed */ } }
}

module.exports = { id, label, roots, files, parse, head, lineOf, patchFiles, programs: ['codex'] };

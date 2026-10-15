'use strict';

/**
 * Claude Code's own session records (index.js): `~/.claude/projects/<the folder, slugged>/<session>.jsonl`, one JSON
 * object a line, and a subagent's beside its session under `<session>/subagents/*.jsonl` (CLAUDE_CONFIG_DIR moves the
 * folder). An assistant message holds its tool calls as `tool_use` blocks; each line names the session and its folder
 * (`cwd`). Only the call is read — its tool, a Bash command, the file an Edit, Write or Read names — never the
 * conversation, the thinking or what a tool gave back. The format is Claude Code's and changes: anything not shaped as
 * expected is skipped.
 */
const os = require('os');
const path = require('path');

const id = 'claude', label = 'Claude Code';

function roots() {
  return [process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(os.homedir(), '.claude', 'projects')];
}

/** The record files: a session's, and its subagents' (two folders below a project's). */
function files(find) {
  return roots().flatMap(r => find(r, { match: f => f.endsWith('.jsonl'), depth: 3 }));
}

const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READ = new Set(['Read']);
const SHELL = new Set(['Bash', 'PowerShell']);

/** One record line: its tool calls as steps (see index.js), or none. */
function parse(line) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) return [];
  const at = Date.parse(o.timestamp) || Date.now();
  const base = { agent: id, label, session: String(o.sessionId || ''), cwd: typeof o.cwd === 'string' ? o.cwd : null, at,
    sub: !!(o.isSidechain || o.agentId) };
  const out = [];
  for (const c of o.message.content) {
    if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue;
    const inp = c.input && typeof c.input === 'object' ? c.input : {};
    const file = inp.file_path || inp.notebook_path;
    const step = { ...base, callId: String(c.id || ''), tool: c.name.slice(0, 80) };
    if (SHELL.has(c.name) && typeof inp.command === 'string') out.push({ ...step, kind: 'command', command: inp.command });
    else if (EDIT.has(c.name) && typeof file === 'string') out.push({ ...step, kind: 'edit', files: [file] });
    else if (READ.has(c.name) && typeof file === 'string') out.push({ ...step, kind: 'read', files: [file] });
    else out.push({ ...step, kind: 'tool' });
  }
  return out;
}

module.exports = { id, label, roots, files, parse, programs: ['claude'] };

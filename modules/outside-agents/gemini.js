'use strict';

/**
 * Gemini CLI's own session records (index.js): `~/.gemini/tmp/<project hash>/chats/session-*.json` (GEMINI_CLI_HOME
 * moves the folder). Unlike the others a record is one JSON document Gemini rewrites as the session goes, so it is read
 * whole — only when it changed, only up to MAX bytes — and a tool call is a step once (by its id). `logs.json` beside it
 * holds the person's prompts and nothing else, so it is never read. A message's `toolCalls` name each call: a shell
 * command, the file a write, edit or read names, else the tool — never the conversation, thoughts or results. The folder
 * is a hash of the project's: it is named by hashing the folders the running Gemini sessions work in (index.js).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const id = 'gemini', label = 'Gemini CLI';
const MAX = 8 * 1024 * 1024;

const roots = () => [path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini', 'tmp')];
const files = find => roots().flatMap(r => find(r, { match: f => /[\\/]chats[\\/]session-[^\\/]*\.json$/.test(f), depth: 2 }));

/** The hash Gemini names a project's folder by. */
const hashOf = dir => crypto.createHash('sha256').update(String(dir)).digest('hex');

const EDIT = new Set(['write_file', 'replace', 'edit']);
const READ = new Set(['read_file']);

/** A session document's tool calls, as steps; `seen` (a Set) keeps each call once. */
function parseDoc(text, seen = new Set()) {
  let o;
  try { o = JSON.parse(text); } catch { return []; }
  if (!o || !Array.isArray(o.messages)) return [];
  const out = [];
  for (const m of o.messages) {
    for (const c of Array.isArray(m?.toolCalls) ? m.toolCalls : []) {
      const key = String(c?.id || `${m.id}:${c?.name}`);
      if (!c || typeof c.name !== 'string' || seen.has(key)) continue;
      seen.add(key);
      const a = c.args && typeof c.args === 'object' ? c.args : {};
      const file = a.file_path || a.absolute_path || a.path;
      const step = { agent: id, label, session: String(o.sessionId || ''), project: typeof o.projectHash === 'string' ? o.projectHash : null,
        cwd: typeof a.directory === 'string' && path.isAbsolute(a.directory) ? a.directory : null,
        at: Date.parse(c.timestamp || m.timestamp) || Date.now(), callId: key, tool: c.name.slice(0, 80) };
      if (c.name === 'run_shell_command' && typeof a.command === 'string') out.push({ ...step, kind: 'command', command: a.command });
      else if (EDIT.has(c.name) && typeof file === 'string') out.push({ ...step, kind: 'edit', files: [file] });
      else if (READ.has(c.name) && typeof file === 'string') out.push({ ...step, kind: 'read', files: [file] });
      else out.push({ ...step, kind: 'tool' });
    }
  }
  return out;
}

/**
 * What a session document holds that was not said yet. `state`: the file's own (its size and time when last read, the
 * calls seen); `fromStart` false on the first read marks what is already there as seen, so nothing old is replayed.
 */
function read(file, state, fromStart, own) {
  const st = own(file);
  if (!st || st.size > MAX) return [];
  if (state.size === st.size && state.mtimeMs === st.mtimeMs) return [];
  const first = !state.seen;
  state.seen = state.seen || new Set();
  state.size = st.size; state.mtimeMs = st.mtimeMs;
  let text;
  let fd = null;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); text = fs.readFileSync(fd, 'utf8'); } catch { return []; } finally { if (fd != null) try { fs.closeSync(fd); } catch { /* closed */ } }
  const steps = parseDoc(text, state.seen);
  return first && !fromStart ? [] : steps;
}

module.exports = { id, label, roots, files, parseDoc, read, hashOf, programs: ['gemini'], whole: true };

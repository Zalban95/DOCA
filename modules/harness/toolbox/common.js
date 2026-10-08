'use strict';

/**
 * What every tool shares: the output bound, the working directory, and where a
 * path may resolve to.
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { WORKSPACE_DIR, FM_ALLOWED_ROOTS } = require('../../paths');
const { fmSafe } = require('../../utils');

/**
 * A memory guard, not the presentation limit.
 *
 * This used to be 8,000 and was described as "characters of tool output handed
 * back to the model". It was the *only* limit at the time, and it was a bad one:
 * it truncated permanently, its message said "[truncated, N more characters]"
 * and gave no way to get them, and it silently disabled the layer above it.
 *
 * `toApiMessages()` clips a tool result over `TOOL_MAX_CHARS` into a head, a
 * tail and a **spill file** holding the whole text — that is the designed
 * escape hatch, and its comment says so: "the spill file is how the model gets
 * the rest". With this at 8,000 and `TOOL_MAX_CHARS` at 16,000, no built-in
 * tool could ever produce a result long enough to reach it. The spill was
 * unreachable for every tool that clips, and the one time it did fire — through
 * `read_file`, which may return 40,000 — the file it wrote held text that
 * `clip()` had *already* truncated. The escape hatch contained a copy of the
 * thing you were escaping from.
 *
 * So the ordering matters and is now pinned by a test: **this must stay well
 * above `TOOL_MAX_CHARS`**, or the layer that preserves output is pre-empted by
 * the layer that destroys it. What is left here is a guard against a runaway
 * command, not a decision about what the model reads.
 */
const MAX_OUT   = 64000;
const SHELL_MS  = 60000;

/**
 * Truncate a tool's output, and say what was lost.
 *
 * Reaching this at all now means the output passed `MAX_OUT`, which is a guard
 * against a runaway command rather than the normal presentation path — the
 * transcript clip handles that, and it spills. So the message says what the
 * reader can actually do about it instead of only how many characters are
 * missing: this layer cannot write a file, so "narrow the command" is the
 * honest instruction and "read the rest from somewhere" would be a lie.
 */
function clip(text, limit = MAX_OUT) {
  const s = String(text ?? '');
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n… [truncated, ${s.length - limit} more characters — the output was larger `
    + 'than this tool hands back, so narrow the command (head, grep, wc) rather than asking again.]';
}

/**
 * The agent's workspace, made the first time it is needed. On a fresh install nothing had made it, and every relative
 * path fell back to the home folder while the agent was told about the workspace (deep test B, C4: `notes/today.md`
 * landed in ~/notes). The home folder is left only when the workspace cannot be made.
 */
function workspace(dir = WORKSPACE_DIR) {
  if (fs.existsSync(dir)) return dir;
  try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch { return os.homedir(); }
}

/**
 * Working directory for shell + relative paths: the project root when this
 * conversation (or the one that dispatched it) is bound to a project
 * (projects/store.forSession), else the agent's workspace.
 */
function cwd(ctx = {}) {
  if (ctx.sessionId) {
    try {
      const p = require('../../projects/store').forSession(ctx.sessionId);
      if (p && fs.existsSync(p.root)) return p.root;
    } catch { /* not in a project */ }
  }
  return workspace();
}

/** For a result: where a relative path landed, so the agent and the person read the folder it really is in. */
function landed(p, abs) {
  return path.isAbsolute(String(p || '').replace(/^~(?=$|[/\\])/, os.homedir())) ? '' : `\n[${p} is ${abs}]`;
}

function resolvePath(p, ctx = {}, { write = false } = {}) {
  const expanded = String(p || '').replace(/^~(?=$|[/\\])/, os.homedir());
  const abs = path.resolve(cwd(ctx), expanded);
  if (!fmSafe(abs) && write)
    // A write, said the same way (deep test A, #33): refused here, the agent said "I'll create the files there with
    // the shell instead" and did — the person had named the place, and nothing asked them.
    throw new Error(`Path is outside the allowed roots (${FM_ALLOWED_ROOTS.join(', ')}): ${abs}. The file tools write only inside `
      + 'the home folder, other disks and the temp folder — a rule of DOCA\'s own, which no setting widens; only the person '
      + 'decides an exception. Do not write it another way (shell, a script, a copy or a move) on your own, even where the person '
      + 'named the place: tell them it is outside where you may write and ask — they can choose a folder inside, or say plainly '
      + 'that you may write it there with the shell.');
  if (!fmSafe(abs))
    // Said as a rule, not an obstacle (deep test B, C12): refused here, the agent read the file with `shell` instead,
    // unasked, and a person reading "allowed roots" believes it is a boundary.
    throw new Error(`Path is outside the allowed roots (${FM_ALLOWED_ROOTS.join(', ')}): ${abs}. The file tools reach only `
      + 'the home folder, other disks and the temp folder; no setting widens them. Do not reach it another way '
      + '(shell, a script, a copy) on your own: tell the person where it is and ask — they can copy it into the workspace, or say you may read it.');
  return abs;
}

/**
 * What an action of a many-action tool needs, said by name before it runs (audit 2026-10-06, aw 18; TODO B4b): a
 * smaller model that leaves out `sessionId` on send is told "send needs sessionId", not an error from three calls deep.
 * `table` maps an action to the fields it needs; returns null when nothing is missing.
 */
function needs(tool, args = {}, table = {}) {
  const want = table[args.action] || [];
  const missing = want.filter(k => args[k] === undefined || args[k] === null || args[k] === '');
  return missing.length ? `Error: ${tool} ${args.action} needs ${missing.join(' and ')}.` : null;
}

module.exports = { MAX_OUT, SHELL_MS, clip, cwd, workspace, landed, resolvePath, needs };

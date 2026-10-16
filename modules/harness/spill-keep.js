'use strict';

/**
 * Keeping the spill folder (`harness/tool-results/<conversation>/`) to a bound (log-keep.js, `logs.toolResultsDays`).
 *
 * The folder holds the whole text of every tool result that is sent shortened (turn/messages.js spillTool, and the
 * cleared stubs of clear-results.js), so the agent can read_file it back. It is a cache of the stored transcript:
 * each request writes the file again when it is missing, for every shortened row it still sends. So a conversation's
 * folder goes when the conversation is gone, or when nothing was written in it for the days set — never while a turn
 * runs there. A conversation picked up again later gets its files back on its next step; what is lost is only a path
 * quoted in a summary of turns no longer sent, which the stored transcript still holds.
 */
const fs = require('fs');
const path = require('path');

const root = () => path.join(require('../store').DATA_DIR, 'harness', 'tool-results');
const DAY = 86400000;

/** Remove what the bound no longer keeps; returns how many folders (and stray files) went. Never throws. */
function prune(days, now = Date.now()) {
  const memory = require('./memory');
  const running = id => { try { return require('./turn/lifecycle').isRunning(id); } catch { return false; } };
  const old = at => !(Number(at) > 0) || now - Number(at) > Number(days) * DAY;
  let entries = [];
  try { entries = fs.readdirSync(root(), { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    const p = path.join(root(), e.name);
    try {
      if (!e.isDirectory()) { if (old(fs.statSync(p).mtimeMs)) { fs.rmSync(p, { force: true }); n++; } continue; }
      if (running(e.name)) continue;
      const s = e.name === 'anon' ? null : memory.getSession(e.name);
      const at = s ? Date.parse(s.updatedAt || s.createdAt || '') : fs.statSync(p).mtimeMs;
      if ((!s && e.name !== 'anon') || old(at)) { fs.rmSync(p, { recursive: true, force: true }); n++; }
    } catch { /* one folder failing does not stop the rest */ }
  }
  return n;
}

module.exports = { prune, root };

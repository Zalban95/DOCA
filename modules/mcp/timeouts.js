'use strict';

/**
 * How long to wait, and where that number comes from.
 *
 * These used to be literals at the two call sites, which made them the kind of
 * limit that stops a turn without being able to say so: the agent hit one
 * mid-render, went looking, found the `= 30000` default on `request()` and
 * reported that as the cause. It was wrong — `callTool` passes its own value
 * and always has — but it was a reasonable reading of code where the real
 * number is written somewhere else entirely. Now there is one place, it has a
 * name, and the name is in the timeout message.
 */
function timeoutFor(kind, serverId = null) {
  // An agents' computer is a sandbox a mission works in for minutes at a time — an install, a sweep of every page, a
  // build — so its calls wait longer than any other server's, by a setting of their own (self-test 2026-10-08, #6:
  // 120 s made every long step "background it and poll", which spent the mission's steps on polling).
  if (kind === 'call' && isComputer(serverId)) {
    const n = Number(require('../settings-schema').value('computers.callTimeoutMs'));
    if (Number.isFinite(n) && n >= 1000) return Math.floor(n);
  }
  const fallback = kind === 'list' ? 20000 : 120000;
  try {
    const { loadPrefs } = require('../utils');
    const n = Number(loadPrefs()?.mcpSettings?.[kind === 'list' ? 'listTimeoutMs' : 'callTimeoutMs']);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
  } catch { return fallback; }
}

const isComputer = id => /^computer-[a-f0-9]+$/.test(String(id || ''));

/** The setting a timeout message names for a request `method`: the one that set the number it gave up after. */
const settingFor = (method, serverId = null) => method === 'tools/call' && isComputer(serverId) ? 'computers.callTimeoutMs'
  : method === 'tools/list' ? 'mcpSettings.listTimeoutMs' : 'mcpSettings.callTimeoutMs';

module.exports = { timeoutFor, settingFor };

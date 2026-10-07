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
function timeoutFor(kind) {
  const fallback = kind === 'list' ? 20000 : 120000;
  try {
    const { loadPrefs } = require('../utils');
    const n = Number(loadPrefs()?.mcpSettings?.[kind === 'list' ? 'listTimeoutMs' : 'callTimeoutMs']);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : fallback;
  } catch { return fallback; }
}

module.exports = { timeoutFor };

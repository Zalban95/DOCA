'use strict';

/**
 * After a secret is used on a device, the hub does not read from that device for a minute (security review
 * 2026-10-07; PROTOCOL.md §22.3). A secret just typed into a window, pasted, or filled into a page can be read straight
 * back — a command line that prints the clipboard, a screenshot of a field a page turned into plain text, a file the
 * window saved — so for HOLD_MS the device's read tools wait. The device holds the same window itself (doca-client's
 * sealed.js, the browser extension's mcp.js, DocaMobile per docs/api/sealed-secrets.md); this half covers a client
 * older than that, and is what the agent's own tool calls pass through (mcp/tools.js call).
 */
const HOLD_MS = 60e3;

/** The tools that read back what was typed, pasted or shown — every family's, by their canonical names and aliases. */
const READS = new Set(['shell', 'shell_run', 'shell_job', 'files_read', 'screen_capture', 'screen_read', 'device_clipboard_read',
  'browser_snapshot', 'browser_screenshot']);

const until = new Map();   // deviceId → ms

/** A secret was handed to this device now (sealed/use.js, before it is used: a read racing it waits too). */
function mark(deviceId) { if (deviceId) until.set(deviceId, Date.now() + HOLD_MS); }

/** The sentence refusing `tool` on `deviceId` while the window is open, or null. */
function blocks(deviceId, tool) {
  const t = until.get(deviceId);
  if (!t || !READS.has(String(tool || ''))) return null;
  const left = t - Date.now();
  if (left <= 0) { until.delete(deviceId); return null; }
  return `Error: a secret was just used on this device, so ${tool} waits ${Math.ceil(left / 1000)} s more — nothing that could read it back runs `
    + 'there for a minute after a use. Clicking and typing carry on.';
}

/** Ends the window (the tests). */
const release = deviceId => (deviceId ? until.delete(deviceId) : until.clear());

module.exports = { mark, blocks, release, READS, HOLD_MS };

'use strict';

/**
 * Which panel uses this data folder, for the tools run beside it (self-test 2026-10-08, #9).
 *
 * `npm run token -- issue` writes into whatever DOCA_DATA_DIR its shell resolves, and a token written into another
 * install's folder — or one no panel reads — looked as valid as any and was then refused (`invalid_token`). A panel
 * that is listening marks the folder (`panel.pid`, JSON: its pid and port, removed when it exits), so the CLI can say
 * whether a running panel will read what it wrote. A mark whose process is gone (a crash, a kill -9) reads as none.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./store');

const file = () => path.join(DATA_DIR, 'panel.pid');

function mark({ port } = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ pid: process.pid, port: port || null, startedAt: new Date().toISOString() }));
    process.once('exit', () => { try { if (JSON.parse(fs.readFileSync(file(), 'utf8')).pid === process.pid) fs.rmSync(file(), { force: true }); } catch {} });
  } catch { /* a read-only folder: the CLI then only warns */ }
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** The panel listening with this folder, `{pid, port, startedAt}`, or null. */
function running() {
  try {
    const m = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Number.isInteger(m.pid) && alive(m.pid) ? m : null;
  } catch { return null; }
}

module.exports = { mark, running, file };

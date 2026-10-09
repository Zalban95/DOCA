'use strict';

/**
 * Holding work for the host's update of a hive that runs the image (deploy/hive.sh update; docs/design/production.md).
 * The host cannot swap a running container's code, so it asks the hive to stop once nothing runs, then starts the new
 * image on the same volume — and the old one again if the new one does not answer.
 *
 * The question travels as a file in the hive's own data folder, written by `node bin/doca-update.js hold` run inside
 * the container (docker exec — only whoever runs the host's Docker can): no route, no token, nothing a person or an
 * agent in the panel can reach. This side watches for it every few seconds:
 *
 *   hold-request.json   {at, by}: asked. The hive waits for its running turns, calls and devices' commands
 *                       (harness/drain.js — no deadline that cuts them, and no automatic turn starts meanwhile), then
 *                       writes hold-state.json {state: 'ready'} and stops; the host's restart policy is off by then.
 *   (request removed)   called off: the wait ends, nothing stopped.
 *
 * Only in a hosted hive, and only a production one: a hive on someone's own machine is updated by its channel (index.js).
 */
const fs = require('fs');
const path = require('path');

const dir = () => path.join(require('../store').DATA_DIR, 'update-channel');
const REQ = () => path.join(dir(), 'hold-request.json');
const STATE = () => path.join(dir(), 'hold-state.json');
const LABEL = 'update by the hive\'s host';
const LONG = 30 * 24 * 3600e3;

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const write = (f, v) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const ours = () => require('../harness/drain').pending()?.label === LABEL;

let _timer = null, _asked = null;

// Stopping waits a few seconds after saying so, so the host's `hold` (polling every second) reads 'ready' first.
function look({ exit = code => setTimeout(() => process.exit(code), 4000) } = {}) {
  const drain = require('../harness/drain');
  const req = read(REQ());
  if (!req) {
    if (_asked) { if (ours()) drain.cancel(); _asked = null; fs.rmSync(STATE(), { force: true }); require('../activity').note({ from: 'updates', what: 'the host called its update off', why: 'nothing was stopped' }); }
    return;
  }
  if (_asked === req.at) { const p = drain.pending(); if (p) write(STATE(), { state: 'waiting', since: _asked, on: p.waitingOn.map(x => x.title) }); return; }
  _asked = req.at;
  require('../activity').note({ from: 'updates', what: 'the host asked this hive to stop for an update', why: `holding running work first (${req.by || 'deploy/hive.sh update'})` });
  drain.whenIdle(() => {
    write(STATE(), { state: 'ready', at: new Date().toISOString() });
    require('../activity').note({ from: 'updates', what: 'stopping for the host\'s update', why: 'nothing was running' });
    exit(0);
  }, { label: LABEL, maxWaitMs: LONG });
  write(STATE(), { state: 'waiting', since: _asked, on: drain.busy().map(x => x.title) });
}

function start() {
  if (_timer || !require('../hosted').on()) return;
  // A start is a new container (or the old one put back): whatever was asked of the one before is done.
  fs.rmSync(REQ(), { force: true }); fs.rmSync(STATE(), { force: true });
  _timer = setInterval(() => { try { look(); } catch { /* the next look */ } }, 3000);
  _timer.unref?.();
}
const stop = () => { clearInterval(_timer); _timer = null; _asked = null; };

module.exports = { start, stop, look, REQ, STATE, LABEL };

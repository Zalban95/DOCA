'use strict';

/**
 * Whether systemd runs this machine, decided once. In a container, or under another init, `systemctl` is often still
 * installed and answers every call with "System has not been booted with systemd as init system (PID 1)" and "Failed
 * to connect to bus" — written into doca.log on every Settings visit (deep test B, R8). The test is systemd's own
 * (sd_booted: /run/systemd/system exists); when it fails DOCA says so once and stops asking.
 */
const fs = require('fs');

let _running = null;

/** True when systemd is this machine's init. `exists` is for tests. */
function running({ exists = fs.existsSync, log = console.log } = {}) {
  if (_running !== null) return _running;
  _running = process.platform === 'linux' && (() => { try { return exists('/run/systemd/system'); } catch { return false; } })();
  if (!_running && process.platform === 'linux') log('[systemd] not running on this machine (no /run/systemd/system): start at boot and systemd look-ups are skipped.');
  return _running;
}

function _reset() { _running = null; }

module.exports = { running, _reset };

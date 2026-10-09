'use strict';

/**
 * This hive's fingerprint, which a machine-bound licence names: sha256 of the hive's own id (made once, kept in the
 * data folder's protected keys) and the machine's id (/etc/machine-id, IOPlatformUUID, MachineGuid). A data folder
 * copied to another machine, or a second hive on the same machine, has another fingerprint — so one licence is one
 * hive on one machine. Nothing here is secret: it is an identifier, shown in Settings → System → Licence.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const file = () => path.join(require('../store').DATA_DIR, 'keys', 'hive-id');

/** The hive's own id: random, made the first time it is asked for. */
function hiveId() {
  try { const id = fs.readFileSync(file(), 'utf8').trim(); if (/^[0-9a-f]{32}$/.test(id)) return id; } catch { /* first time */ }
  const id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), id + '\n', { mode: 0o600 });
  return id;
}

/** The OS's own id for this machine; the host name when none can be read (a container without one, say). */
function machineId() {
  const quiet = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  let id = '';
  if (process.platform === 'linux') for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { id = fs.readFileSync(f, 'utf8').trim(); } catch { /* next */ } if (id) break; }
  else if (process.platform === 'darwin') id = (/"IOPlatformUUID" = "([^"]+)"/.exec(quiet('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])) || [])[1] || '';
  else if (process.platform === 'win32') id = (/MachineGuid\s+REG_SZ\s+(\S+)/.exec(quiet('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])) || [])[1] || '';
  return id ? { id, from: 'os' } : { id: `host:${os.hostname()}`, from: 'hostname' };
}

let cached = null;
function fingerprint() {
  if (!cached) {
    const m = machineId();
    cached = { value: crypto.createHash('sha256').update(`doca-hive:${hiveId()}:${m.id}`).digest('hex'), machineFrom: m.from };
  }
  return cached;
}

module.exports = { fingerprint, hiveId, machineId, _reset: () => { cached = null; } };

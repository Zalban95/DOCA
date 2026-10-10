'use strict';

/**
 * The Android emulators running on this machine, for Machines → Live (asked 2026-10-10: helpers ran emulators all
 * evening and Live said "Nothing to watch yet"). Read from `adb devices -l` (the SDK's adb: ANDROID_HOME, the usual
 * SDK folders, else PATH) at most every TTL_MS, and only while a Live page asks. Only serials `emulator-<port>` are
 * listed: a real phone or watch plugged in is a person's device, pictured only when the owner turns on
 * `machines.adbDevices` (Settings; off by default). Each is pictured by `adb -s <serial> exec-out screencap -p`
 * (cmd-shots.js) and named by its AVD (`adb -s <serial> emu avd name`, kept per serial).
 * Who started it: an emulator is started outside DOCA unless its process is below this hub (an agent's job).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TTL_MS = 5000;
let _cache = null, _pending = null;
const _names = new Map();   // serial → AVD name

/** The adb this machine has, or null. */
function adb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdks = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Android', 'Sdk'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean);
  for (const s of sdks) { const p = path.join(s, 'platform-tools', exe); if (fs.existsSync(p)) return p; }
  try { return require('../shell').which('adb'); } catch { return null; }
}

const run = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { timeout: 8000, windowsHide: true },
  (err, out) => (err ? reject(err) : resolve(String(out)))));

/** `adb devices -l` → [{ serial, state, model, emulator }]. */
function parse(text) {
  return String(text || '').split(/\r?\n/).slice(1).map(l => l.trim()).filter(Boolean).map(l => {
    const [serial, state, ...rest] = l.split(/\s+/);
    const kv = Object.fromEntries(rest.map(x => x.split(':')).filter(x => x.length === 2));
    return { serial, state, model: kv.model || null, device: kv.device || null, emulator: /^emulator-\d+$/.test(serial) };
  }).filter(d => d.serial && d.state);
}

async function read() {
  const bin = module.exports.adb();
  if (!bin) return { list: [], why: 'adb is not installed (the Android SDK\'s platform-tools)' };
  let text;
  try { text = await module.exports.run(bin, ['devices', '-l']); } catch (e) { return { list: [], why: `adb did not answer: ${String(e.message).split('\n')[0]}` }; }
  const real = require('../settings-schema').value('machines.adbDevices');
  const list = parse(text).filter(d => d.state === 'device' && (d.emulator || real));
  for (const d of list) {
    if (!_names.has(d.serial) && d.emulator) {
      const name = await module.exports.run(bin, ['-s', d.serial, 'emu', 'avd', 'name']).then(o => o.split(/\r?\n/)[0].trim(), () => '');
      _names.set(d.serial, name && name !== 'OK' ? name : null);
    }
    d.name = _names.get(d.serial) || (d.model ? d.model.replace(/_/g, ' ') : d.serial);
  }
  return { list, bin };
}

/** The emulators (and, when allowed, devices) now, at most TTL_MS old. */
function list() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return Promise.resolve(_cache);
  if (!_pending) _pending = read().then(r => (_cache = { at: Date.now(), ...r })).finally(() => { _pending = null; });
  return _pending;
}

const keyOf = serial => `adb:${serial}`;
/** The command that pictures one (cmd-shots.js). */
const source = (d, bin) => ({ key: keyOf(d.serial), bin, args: ['-s', d.serial, 'exec-out', 'screencap', '-p'] });

module.exports = { list, parse, adb, run, keyOf, source, TTL_MS, _reset: () => { _cache = null; _names.clear(); } };

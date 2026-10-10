'use strict';

/**
 * Pictures taken by a command that writes a PNG to its output, for Machines → Live (asked 2026-10-10): an Android
 * emulator's screen (`adb -s <serial> exec-out screencap -p`, emulators.js) and a computer container no record names
 * (`docker exec <name> ffmpeg … x11grab …`, stray-computers.js). The same cadence and budget as the VMs' (vm-shots.js):
 * a picture every SHOT_MS while a Live page asks, at most MAX, stopped IDLE_MS after the last ask, made small by png.js
 * and kept in memory only. Each source is { key, bin, args } — argv, never a shell.
 */
const { execFile } = require('child_process');

const SHOT_MS = 4000, IDLE_MS = 60000, MAX = 6;
let _wanted = [], _timer = null, _idle = null, _round = null;
const _shots = new Map(), _errors = new Map();

/** The command, by argv; the test stands in for it here. */
const exec = (bin, args) => new Promise((resolve, reject) => execFile(bin, args, { timeout: 15000, windowsHide: true, encoding: 'buffer', maxBuffer: 32 << 20 },
  (err, out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n')[0] || 'no picture')) : resolve(out))));

async function shoot(src) {
  try {
    const out = await module.exports.exec(src.bin, src.args);
    const at = out.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));   // adb on an old Android may print a line first
    if (at < 0) throw new Error('No PNG came back.');
    _shots.set(src.key, require('./png').small(out.subarray(at)));
    _errors.delete(src.key);
  } catch (e) { _errors.set(src.key, e.message); }
}

function round() {
  if (!_round) _round = (async () => { for (const s of _wanted) await shoot(s); })().finally(() => { _round = null; });
  return _round;
}

/** The sources a Live page shows now: pictures for those, the rest forgotten. */
function want(sources) {
  clearTimeout(_idle);
  _idle = setTimeout(stop, IDLE_MS);
  _idle.unref?.();
  _wanted = sources.slice(0, MAX);
  const keep = new Set(_wanted.map(s => s.key));
  for (const k of [..._shots.keys()]) if (!keep.has(k)) _shots.delete(k);
  if (!_timer && _wanted.length) {
    _timer = setInterval(round, SHOT_MS);
    _timer.unref?.();
    round();
  }
}

function stop() {
  clearInterval(_timer); clearTimeout(_idle);
  _timer = null; _wanted = []; _shots.clear(); _errors.clear();
}

const get = key => _shots.get(key) || null;
const has = key => _shots.has(key);
const error = key => _errors.get(key) || null;

module.exports = { want, get, has, error, stop, round, exec, SHOT_MS, MAX };

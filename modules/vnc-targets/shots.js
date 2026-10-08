'use strict';

/**
 * Pictures of the VNC targets for Machines → Live, read by DOCA's own RFB client (rfb.js) — the VMs' cadence and budget
 * (machines/vm-shots.js): only while a Live page asks, one every SHOT_MS, at most MAX, stopped IDLE_MS after the last
 * ask, in memory only, made small by machines/png.js.
 */
const SHOT_MS = 4000, IDLE_MS = 60000, MAX = 6;
let _wanted = [], _timer = null, _idle = null, _round = null;
const _shots = new Map();    // id → PNG
const _errors = new Map();   // id → why the last picture failed

const png = () => require('../machines/png');

/** One target's screen now: a PNG at most maxWidth wide, the screen's size and how many times smaller the PNG is (vnc_look's too). */
async function capture(id, maxWidth = 960) {
  const target = require('./store').connection(id);
  if (!target) throw Object.assign(new Error('No such VNC target.'), { status: 404 });
  const img = await require('./rfb').capture(target);
  return { png: png().encode(png().shrink(img, maxWidth)), width: img.width, height: img.height, scale: Math.max(1, Math.ceil(img.width / maxWidth)) };
}

async function shoot(id) {
  try { _shots.set(id, (await capture(id)).png); _errors.delete(id); }
  catch (e) { _errors.set(id, e.message); }
}

function round() {
  if (!_round) _round = (async () => { for (const id of _wanted) await shoot(id); })().finally(() => { _round = null; });
  return _round;
}

/** The targets a Live page shows now (ids): pictures for them; the rest forgotten. */
function want(ids) {
  clearTimeout(_idle);
  _idle = setTimeout(stop, IDLE_MS);
  _idle.unref?.();
  _wanted = ids.slice(0, MAX);
  for (const k of [..._shots.keys()]) if (!_wanted.includes(k)) _shots.delete(k);
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

const get = id => _shots.get(id) || null;
const has = id => _shots.has(id);
const error = id => _errors.get(id) || null;

module.exports = { capture, want, get, has, error, stop, round, SHOT_MS, MAX };

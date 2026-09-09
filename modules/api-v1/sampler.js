'use strict';

/**
 * Shared status sampler.
 *
 * Collects the platform status object once per tick and caches it, so any
 * number of connected clients share one CPU sample and one set of child
 * processes. Ticks only while there is demand (a live stream or a recent
 * snapshot request) and stops after SAMPLER_IDLE_STOP_SEC of silence.
 *
 * Also keeps a short per-metric history ring used for sparklines and
 * server-rendered charts.
 */
const { EventEmitter } = require('events');
const { collectStatus } = require('../controls');
const L = require('./limits');

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let _latest      = null;   // { status, observedAt, stale }
let _timer       = null;
let _intervalSec = 5;
let _lastDemand  = 0;
let _inflight    = null;
const _history   = new Map(); // metricId → [{ t, v }]

/** Record one numeric point for a metric. */
function record(metricId, value, t) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  let arr = _history.get(metricId);
  if (!arr) { arr = []; _history.set(metricId, arr); }
  arr.push({ t, v: value });
  if (arr.length > L.HISTORY_MAX_POINTS) arr.splice(0, arr.length - L.HISTORY_MAX_POINTS);
}

function history(metricId, maxPoints) {
  const arr = _history.get(metricId) || [];
  return maxPoints ? arr.slice(-maxPoints) : arr.slice();
}

function spark(metricId, n = L.SPARK_MAX_POINTS) {
  return history(metricId, n).map(p => p.v);
}

/** Extract the numeric series worth remembering from a status object. */
function recordFromStatus(status, t) {
  const s = status.system || {};
  record('system.cpu.pct',  s.cpuPct, t);
  record('system.cpu.temp', s.cpuTemp, t);
  record('system.cpu.freq', s.cpuFreqMHz, t);
  record('system.load.1',   s.load1, t);
  record('system.load.5',   s.load5, t);
  record('system.load.15',  s.load15, t);
  if (s.ramTotal) record('system.memory.pct', Math.round(s.ramUsed / s.ramTotal * 100), t);
  record('system.memory.used', s.ramUsed != null ? s.ramUsed * 1e6 : null, t);
  if (s.swapTotal) record('system.memory.swap.pct', Math.round(s.swapUsed / s.swapTotal * 100), t);
  if (s.diskIO) { record('system.network.disk.read', s.diskIO.readBps, t); record('system.network.disk.write', s.diskIO.writeBps, t); }
  if (Array.isArray(s.net)) for (const n of s.net) { record(`system.network.${n.iface}.rx`, n.rxBps, t); record(`system.network.${n.iface}.tx`, n.txBps, t); }
  (status.gpu || []).forEach((g, i) => {
    record(`gpu.${i}.temp`, parseFloat(g.temp), t);
    record(`gpu.${i}.util`, parseFloat(g.util), t);
    const used = parseFloat(g.memUsed), total = parseFloat(g.memTotal);
    if (total > 0) record(`gpu.${i}.vram.pct`, Math.round(used / total * 100), t);
    record(`gpu.${i}.vram.used`, used * 1024 * 1024, t);
    record(`gpu.${i}.power`, g.powerDraw, t);
    record(`gpu.${i}.fan`, g.fan, t);
  });
}

/** Collect now (coalescing concurrent callers). */
function refresh() {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const t = Date.now();
    try {
      const status = await collectStatus();
      _latest = { status, observedAt: new Date(t).toISOString(), stale: false };
      recordFromStatus(status, t);
    } catch (e) {
      if (_latest) _latest = { ..._latest, stale: true, error: e.message };
      else _latest = { status: null, observedAt: new Date(t).toISOString(), stale: true, error: e.message };
    } finally { _inflight = null; }
    emitter.emit('sample', _latest);
    return _latest;
  })();
  return _inflight;
}

function tick() {
  if (Date.now() - _lastDemand > L.SAMPLER_IDLE_STOP_SEC * 1000) { stop(); return; }
  refresh();
}

function start() {
  if (_timer) return;
  _timer = setInterval(tick, _intervalSec * 1000);
  if (_timer.unref) _timer.unref();
  refresh();
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

/**
 * Declare demand for samples at most every `intervalSec`. The sampler runs
 * at the fastest interval requested (floored) while demand is fresh.
 */
function demand(intervalSec) {
  _lastDemand = Date.now();
  const want = Math.max(L.SAMPLER_MIN_INTERVAL_SEC, intervalSec || 5);
  if (_timer && want < _intervalSec) { _intervalSec = want; stop(); start(); return; }
  if (!_timer) { _intervalSec = want; start(); }
}

/** Latest cached sample, collecting first if there is none. */
async function latest(maxAgeSec = 10) {
  _lastDemand = Date.now();
  if (_latest && Date.now() - Date.parse(_latest.observedAt) < maxAgeSec * 1000) return _latest;
  return refresh();
}

function intervalSec() { return _intervalSec; }

function _reset() { stop(); _latest = null; _history.clear(); _lastDemand = 0; }

module.exports = { emitter, demand, latest, refresh, record, history, spark, intervalSec, stop, _reset };

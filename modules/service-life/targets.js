'use strict';

/**
 * What the hub may stop and start on its own (asked 2026-10-08: "if the service has been started from something else,
 * the panel doesn't switch it off automatically if it doesn't use it, or if the panel goes off"): each inference
 * service of the Services tab (a container `doca-<id>`, services.js) and each llama.cpp server this panel runs
 * (models-llamacpp.js), as `{ key: '<kind>:<id>', kind, id, label, port }`. Starting and stopping go through the same
 * handlers the panel's buttons call, so a start here is the start a person would have clicked — same image, GPU,
 * model and wait for the service to answer.
 *
 * `ops` is the seam the tests use in place of docker and llama-server (a stand-in that keeps what runs in memory).
 */
const CACHE_MS = 5000;
let _running = null;   // { at, set: Set<key> }
let _list = null;      // { at, out }: every request asks by port, and reading the prefs file each time is not needed

function list() {
  if (_list && Date.now() - _list.at < CACHE_MS) return _list.out;
  const out = require('../services').INFERENCE_SERVICES.map(s => ({ key: `service:${s.id}`, kind: 'service', id: s.id, label: s.label || s.id, port: s.port, speech: !!s.speech }));
  try {
    for (const i of require('../models-llamacpp').loadInstances())
      out.push({ key: `llamacpp:${i.id}`, kind: 'llamacpp', id: i.id, label: `the llama.cpp server ${i.name || i.id}`, port: Number(i.port) || null });
  } catch { /* no instances */ }
  _list = { at: Date.now(), out };
  return out;
}

const get = key => list().find(t => t.key === key) || null;

/** The target answering on this machine's `port`, or null. */
function byPort(port) { return port ? list().find(t => t.port === Number(port)) || null : null; }

const invoke = (handler, body) => require('../api-v1/jobs').invokeHandler(handler, { body });
const lastStatus = r => { const s = (r.stream || []).filter(x => x && typeof x === 'object'); return s[s.length - 1] || {}; };

const real = {
  /** Keys of the targets running now. */
  async running() {
    const set = new Set();
    try {
      for (const c of await require('../containers').ps({ all: false })) {
        const m = /^doca-(.+)$/.exec(String(c.Names || '').split(',')[0]);
        if (m && String(c.State || 'running').toLowerCase() === 'running') set.add(`service:${m[1]}`);
      }
    } catch { /* no docker: no services running */ }
    try { for (const i of require('../models-llamacpp').getRunningInstances()) set.add(`llamacpp:${i.id}`); } catch { /* none */ }
    return set;
  },
  /** Start one as its row's own settings say; resolves { ok, why } once it answers (or did not). */
  async start(t) {
    if (t.kind === 'service') {
      const saved = (require('../utils').loadPrefs().serviceSettings || {})[t.id] || {};
      const r = await invoke(require('../services').handleStart, { id: t.id, gpu: saved.gpu ?? 'all', modelId: saved.modelId || '' });
      const last = lastStatus(r);
      return last.ok ? { ok: true } : { ok: false, why: String(last.status || r.body?.error || 'it did not start').split('\n').pop().replace(/^✗\s*/, '') };
    }
    const r = await invoke(require('../models-llamacpp').handleStart, { id: t.id });
    if (r.body?.error) return { ok: false, why: r.body.error };
    if (!lastStatus(r).ok) return { ok: false, why: String(lastStatus(r).status || 'it did not start').trim() };
    return (await answers(t.port, 120000)) ? { ok: true } : { ok: false, why: `it did not answer on :${t.port}` };
  },
  async stop(t) {
    const r = await invoke(t.kind === 'service' ? require('../services').handleStop : require('../models-llamacpp').handleStop, { id: t.id });
    return r.body?.error ? { ok: false, why: String(r.body.error).slice(0, 200) } : { ok: true };
  },
};

/** Whether something answers on this machine's port within `ms`. */
async function answers(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return true; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

let ops = real;

/** Running keys, read at most every CACHE_MS (`fresh` reads now). */
async function running({ fresh = false } = {}) {
  if (!fresh && _running && Date.now() - _running.at < CACHE_MS) return _running.set;
  const set = await ops.running();
  _running = { at: Date.now(), set };
  return set;
}

async function start(t) { try { return await ops.start(t); } catch (e) { return { ok: false, why: e.message }; } finally { _running = null; } }
async function stop(t) { try { return await ops.stop(t); } catch (e) { return { ok: false, why: e.message }; } finally { _running = null; } }

module.exports = { list, get, byPort, running, start, stop, _ops: o => { ops = o || real; _running = null; _list = null; }, _forget: () => { _running = null; _list = null; } };

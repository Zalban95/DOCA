'use strict';

/**
 * For this machine, per role: the best suggested model that fits with room to spare, or — when none does — the
 * providers that serve that role, that a key is needed and where to get one (CONSTITUTION §1: "when the machine
 * cannot bear something it says so and offers the providers' options").
 *
 * Fits means: on one GPU when its memory holds the model with MARGIN to spare (and the machine's memory holds the
 * rest); else split over the cards of one maker (`gpus`, Ollama and llama.cpp do this, a little slower, so it needs
 * SPLIT more); or on the CPU only for what the list marks `cpuOk` (embeddings, speech, a mixture of experts that
 * works only a few billion parameters per token) — a dense chat model on a CPU answers, but not well enough to be what
 * someone meets first. Disk is checked when it is known. Pure: the assessment and the list come in, so it is tested
 * with made-up machines (classes.js).
 */
const MARGIN = 1.15;     // the model plus 15% for its context and the runtime
const SPLIT = 1.1;       // a model split over cards repeats some buffers on each
const OS_ROOM_GB = 2;    // memory the system keeps for itself
const SPLITS = new Set(['ollama', 'llama.cpp']);

function fit(m, a) {
  const n = m.needs || {};
  if (a.diskGB != null && (n.diskGB || 0) * 1.1 > a.diskGB) return { where: null, why: `needs ${n.diskGB} GB of disk, ${a.diskGB} GB free` };
  const ramOk = (n.ramGB || 0) <= a.ramGB;
  if (a.gpuGB && n.vramGB * MARGIN <= a.gpuGB && ramOk) return { where: 'gpu' };
  if (SPLITS.has(m.runtime) && a.gpuTotalGB > a.gpuGB && n.vramGB * MARGIN * SPLIT <= a.gpuTotalGB && ramOk) return { where: 'gpus' };
  if (m.cpuOk && (n.ramGB || 0) * MARGIN + OS_ROOM_GB <= a.ramGB) return { where: 'cpu' };
  return { where: null, why: a.gpuGB ? `needs ${n.vramGB} GB of graphics memory, this machine has ${a.gpuGB} GB`
    : m.cpuOk ? `needs ${n.ramGB} GB of memory` : `needs a graphics card with ${n.vramGB} GB` };
}

/**
 * The best first: on a graphics card before on the processor (a card that holds something good is why it is there);
 * then the list's rank (quality, from the evidence its sources give); at the same rank one card before a split over
 * several (faster, and the other card stays free), then the larger quantization, then the newer.
 */
const ON_CPU = w => (w === 'cpu' ? 1 : 0);
const WHERE = { gpu: 0, gpus: 1, cpu: 2 };
const order = (x, y) => (ON_CPU(x.f.where) - ON_CPU(y.f.where)) || ((y.m.rank || 0) - (x.m.rank || 0))
  || (WHERE[x.f.where] ?? 3) - (WHERE[y.f.where] ?? 3)
  || (y.m.needs.vramGB - x.m.needs.vramGB) || String(y.m.released || '').localeCompare(String(x.m.released || ''));

/** The hosted providers for a role, as the panel knows them: label, whether a key is here, where to get one. */
function providersFor(role, doc, known = null) {
  let list = known;
  if (!list) { try { list = require('../harness/providers').list(); } catch { list = []; } }
  const byId = Object.fromEntries(list.map(p => [p.id, p]));
  const presets = (() => { try { return require('../harness/providers').PRESETS; } catch { return {}; } })();
  return (doc.hosted?.[role] || []).map(id => ({ id, label: byId[id]?.label || presets[id]?.label || id,
    hasKey: !!byId[id]?.hasKey, keyPage: doc.keyPages?.[id] || null }));
}

function pickRole(role, a, doc, opts = {}) {
  const tried = doc.models.filter(m => m.role === role).map(m => ({ m, f: fit(m, a) }));
  const ok = tried.filter(t => t.f.where).sort(order);
  const best = ok[0] ? { ...ok[0].m, where: ok[0].f.where } : null;
  // The smallest that did not fit says what it would take, in the person's words.
  const closest = !best && tried.length ? tried.slice().sort((x, y) => x.m.needs.vramGB - y.m.needs.vramGB)[0] : null;
  return {
    role, label: doc.roles?.[role]?.label || role,
    local: best,
    alternatives: ok.slice(1, 3).map(t => ({ id: t.m.id, label: t.m.label, where: t.f.where })),
    tooBig: closest ? { id: closest.m.id, label: closest.m.label, why: closest.f.why } : null,
    providers: providersFor(role, doc, opts.providers),
    providersNote: doc.hostedNote?.[role] || null,
  };
}

function pickAll(a, doc, roles = Object.keys(doc.roles || {}), opts = {}) {
  return roles.map(r => pickRole(r, a, doc, opts));
}

/** The hub's shape: `local` when it can run its own agent model, `preset` when it lives on providers' keys. */
function shapeOf(a, doc) {
  return pickRole('chat', a, doc, { providers: [] }).local ? 'local' : 'preset';
}

module.exports = { fit, pickRole, pickAll, shapeOf, providersFor, MARGIN, SPLIT };

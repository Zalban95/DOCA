'use strict';

/**
 * For this machine, per role: the newest suggested model that fits with room to spare, or — when none does — the
 * providers that serve that role, that a key is needed and where to get one (CONSTITUTION §1: "when the machine
 * cannot bear something it says so and offers the providers' options").
 *
 * Fits means: on the GPU when its memory holds the model with MARGIN to spare (and the machine's memory holds the
 * rest), or on the CPU only for what the list marks `cpuOk` (embeddings, speech) — a chat model on a CPU answers,
 * but not well enough to be what someone meets first. Disk is checked when it is known. Pure: the assessment and
 * the list come in, so it is tested with made-up machines.
 */
const MARGIN = 1.15;     // the model plus 15% for its context and the runtime
const OS_ROOM_GB = 2;    // memory the system keeps for itself

function fit(m, a) {
  const n = m.needs || {};
  if (a.diskGB != null && (n.diskGB || 0) * 1.1 > a.diskGB) return { where: null, why: `needs ${n.diskGB} GB of disk, ${a.diskGB} GB free` };
  if (a.gpuGB && n.vramGB * MARGIN <= a.gpuGB && (n.ramGB || 0) <= a.ramGB) return { where: 'gpu' };
  if (m.cpuOk && (n.ramGB || 0) * MARGIN + OS_ROOM_GB <= a.ramGB) return { where: 'cpu' };
  return { where: null, why: a.gpuGB ? `needs ${n.vramGB} GB of graphics memory, this machine has ${a.gpuGB} GB`
    : m.cpuOk ? `needs ${n.ramGB} GB of memory` : `needs a graphics card with ${n.vramGB} GB` };
}

/** Newest first; within one release, the larger (the better) first. */
const order = (x, y) => String(y.released || '').localeCompare(String(x.released || '')) || (y.needs.vramGB - x.needs.vramGB);

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
  // A model marked `want` is offered only to whoever asked for what it is for, and then before the rest (when it fits).
  const want = opts.want || [];
  const all = doc.models.filter(m => m.role === role && (!m.want || want.includes(m.want)))
    .sort((x, y) => (y.want ? 1 : 0) - (x.want ? 1 : 0) || order(x, y));
  const tried = all.map(m => ({ m, f: fit(m, a) }));
  const ok = tried.filter(t => t.f.where);
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

module.exports = { fit, pickRole, pickAll, shapeOf, providersFor, MARGIN };

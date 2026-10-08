'use strict';

/**
 * The size classes the suggested models are chosen for (docs/design/model-suggestions.md): the machines people
 * actually have, each as the readings assess.js takes — a graphics card's memory as nvidia-smi reports it (MiB), a
 * Mac's shared memory, or no card at all. The model scout reads the pick for each (the `model_scout` tool's
 * `suggestions` action) to see where a newer model would do better, and the tests hold the list to the right pick
 * for each. A machine's own assessment is never one of these: they are for comparing, not for guessing.
 */
const GB = 2 ** 30;
const card = (name, mib) => ({ name, memTotal: String(mib), vendor: 'nvidia', source: 'nvidia-smi' });
const mac = gb => ({ name: 'Apple GPU', memTotal: gb * 1024, unified: true, vendor: 'apple' });
const ok = { docker: true, ollama: true, llamacpp: false };

const CLASSES = [
  { id: 'gpu-8', label: 'one 8 GB graphics card', ram: 32, gpus: [card('8 GB card', 8188)] },
  { id: 'gpu-12', label: 'one 12 GB graphics card', ram: 32, gpus: [card('12 GB card', 12282)] },
  { id: 'gpu-16', label: 'one 16 GB graphics card', ram: 32, gpus: [card('16 GB card', 16311)] },
  { id: 'gpu-24', label: 'one 24 GB graphics card', ram: 64, gpus: [card('24 GB card', 24564)] },
  { id: 'gpu-2x16', label: 'two 16 GB graphics cards', ram: 64, gpus: [card('16 GB card', 16311), card('16 GB card', 16311)] },
  { id: 'gpu-32', label: 'one 32 GB graphics card', ram: 64, gpus: [card('32 GB card', 32607)] },
  { id: 'gpu-48', label: 'a 48 GB graphics card', ram: 128, gpus: [card('48 GB card', 49140)] },
  { id: 'gpu-2x24', label: 'two 24 GB graphics cards', ram: 128, gpus: [card('24 GB card', 24564), card('24 GB card', 24564)] },
  { id: 'apple-16', label: 'a Mac with 16 GB', ram: 16, platform: 'darwin', gpus: [mac(16)] },
  { id: 'apple-32', label: 'a Mac with 32 GB', ram: 32, platform: 'darwin', gpus: [mac(32)] },
  { id: 'apple-64', label: 'a Mac with 64 GB', ram: 64, platform: 'darwin', gpus: [mac(64)] },
  { id: 'cpu-16', label: 'no graphics card, 16 GB of memory', ram: 16, gpus: [] },
  { id: 'cpu-32', label: 'no graphics card, 32 GB of memory', ram: 32, gpus: [] },
  { id: 'cpu-64', label: 'no graphics card, 64 GB of memory', ram: 64, gpus: [] },
];

/** A class as assess() reads it: plenty of disk, the runtimes present, so only memory decides. */
function readings(c) {
  return { platform: c.platform || 'linux', arch: c.platform === 'darwin' ? 'arm64' : 'x64', cpuModel: c.label, cores: 16,
    totalBytes: c.ram * GB, diskFreeBytes: 2000 * GB, gpus: c.gpus, runtimes: ok };
}

/** Every class with the pick for each role, from a suggestions list: what the scout compares the world against. */
async function picks(doc, roles = ['chat', 'coding', 'vision', 'embeddings']) {
  const { assess } = require('./assess'), { pickRole } = require('./pick');
  const out = [];
  for (const c of CLASSES) {
    const a = await assess(readings(c));
    out.push({ id: c.id, label: c.label, picks: Object.fromEntries(roles.map(r => {
      const p = pickRole(r, a, doc, { providers: [] }).local;
      return [r, p ? { id: p.id, label: p.label, where: p.where, rank: p.rank, local: !!p.local } : null];
    })) });
  }
  return out;
}

module.exports = { CLASSES, readings, picks };

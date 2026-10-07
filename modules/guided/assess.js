'use strict';

/**
 * What this machine can bear (CONSTITUTION §1, "Two shapes, two set-ups"; TODO P1.5): memory, each GPU's own
 * memory, free disk, the CPU, the OS, and which runtimes are already here (Docker or Podman, Ollama, llama.cpp).
 * Read the way the rest of DOCA reads them — gpu.js for the GPUs (nvidia-smi, rocm-smi, ioreg, sysfs, the Windows
 * adapters), shell.which for programs, fs.statfs for the disk — so it answers the same on Linux, Windows and macOS.
 *
 * `assess(readings)` takes any reading already known (tests pass them all; nothing is run for one given), and
 * returns the numbers the picker needs: `gpuGB` (the largest single GPU's memory a model can use), `ramGB`, `diskGB`.
 * A reading nothing gave is null, never 0, and the summary says so instead of guessing.
 */
const os = require('os');
const fs = require('fs');

const GB = 2 ** 30;
const round = n => (n == null ? null : Math.round(n * 10) / 10);

/** On Apple silicon the GPU shares the machine's memory; macOS lets it wire about two thirds of it. */
const APPLE_SHARE = 0.66;

function diskFreeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** The programs that matter for running models here, found on PATH (no subprocess). */
function runtimes(which) {
  const has = b => !!which(b);
  return { docker: has('docker') || has('podman'), ollama: has('ollama'), llamacpp: has('llama-server') };
}

/** gpu.js's rows → {name, vendor, vramGB, unified, approx}. memTotal is MiB there (a string from nvidia-smi). */
function gpusOf(rows, totalBytes) {
  return (rows || []).map(g => {
    const mib = Number(g.memTotal);
    const unified = !!g.unified || g.vendor === 'apple';
    const vramGB = unified ? round(totalBytes / GB * APPLE_SHARE) : Number.isFinite(mib) && mib > 0 ? round(mib / 1024) : null;
    // Win32_VideoController's AdapterRAM is 32 bits: a card with more than 4 GB reads as 4.
    return { name: g.name || 'GPU', vendor: g.vendor || 'other', vramGB, unified, approx: g.source === 'Win32_VideoController' || undefined };
  });
}

async function assess(readings = {}) {
  const r = { ...readings };
  const shell = () => require('../shell');
  r.platform ??= process.platform;
  r.arch ??= os.arch();
  r.cpuModel ??= (os.cpus()[0]?.model || '').trim() || null;
  r.cores ??= os.cpus().length;
  r.totalBytes ??= os.totalmem();
  r.diskFreeBytes = r.diskFreeBytes !== undefined ? r.diskFreeBytes : diskFreeBytes(os.homedir());
  if (r.gpus === undefined) { try { r.gpus = await require('../gpu').read(); } catch { r.gpus = null; } }
  r.runtimes ??= runtimes(b => shell().which(b));

  const gpus = gpusOf(r.gpus, r.totalBytes).filter(g => g.vendor !== 'intel' || g.vramGB);   // integrated Intel: no memory of its own
  // The largest single card: a model split over two cards runs, but slower — "fits" means runs well on one.
  const gpuGB = gpus.reduce((m, g) => Math.max(m, g.vramGB || 0), 0) || 0;
  const out = {
    os: { platform: r.platform, name: { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[r.platform] || r.platform, arch: r.arch },
    cpu: { model: r.cpuModel, cores: r.cores },
    ramGB: round(r.totalBytes / GB),
    gpus,
    gpuGB,
    diskGB: r.diskFreeBytes == null ? null : round(r.diskFreeBytes / GB),
    runtimes: r.runtimes,
  };
  out.summary = summary(out);
  return out;
}

/** The machine in one plain sentence, for the set-up page and the agent. */
function summary(a) {
  const g = a.gpus.filter(x => x.vramGB);
  const each = g.map(x => `${x.name} (${x.vramGB} GB${x.unified ? ' shared with the system' : ''}${x.approx ? ', maybe more' : ''})`);
  const counted = [...new Set(each)].map(t => { const n = each.filter(x => x === t).length; return n > 1 ? `${n}× ${t}` : t; });
  const gpu = !g.length ? 'no graphics card a model can use' : counted.join(', ');
  const have = Object.entries({ Docker: a.runtimes.docker, Ollama: a.runtimes.ollama, 'llama.cpp': a.runtimes.llamacpp }).filter(([, v]) => v).map(([k]) => k);
  return `${a.os.name} with ${a.cpu.cores} CPU cores, ${a.ramGB} GB of memory, ${gpu}, `
    + `${a.diskGB == null ? 'free disk unknown' : `${a.diskGB} GB free on disk`}; ${have.length ? `${have.join(', ')} installed` : 'no model runtime installed yet'}.`;
}

module.exports = { assess, gpusOf, summary, APPLE_SHARE };

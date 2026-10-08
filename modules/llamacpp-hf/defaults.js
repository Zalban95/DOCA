'use strict';

/**
 * How a llama.cpp server for a downloaded GGUF starts out: how many layers go on the graphics cards and how much
 * context it keeps, from the files' size and what this machine has (guided/assess.js). An estimate, said as one, that
 * the person can change under Advanced: all layers on the card when the model fits with room to spare (or on the cards
 * of one maker together); otherwise `auto`, which leaves it to llama.cpp's own fitting (`--fit`, on by default in its
 * recent builds). The context is the model's own (its GGUF metadata, as the Hub reports it), capped by the memory left
 * beside the model — a context the card cannot hold is a server that will not start.
 */
const GB = 2 ** 30;
const MARGIN = 1.15;   // guided/pick.js's: the model plus room for its context and the runtime
const STEPS = [[6, 65536], [3, 32768], [1.5, 16384], [0.75, 8192]];

function plan({ bytes = 0, native = null, gpuGB = 0, gpuTotalGB = 0 } = {}) {
  const size = bytes / GB;
  let ngl = 'auto', room = 0, where = 'split between the graphics card and the processor (llama.cpp decides)';
  if (gpuGB && size * MARGIN <= gpuGB) { ngl = 999; room = gpuGB - size * 1.1 - 0.3; where = 'on one graphics card'; }
  else if (gpuTotalGB > gpuGB && size * MARGIN * 1.1 <= gpuTotalGB) { ngl = 999; room = gpuTotalGB - size * 1.2 - 0.6; where = 'split over the graphics cards'; }
  else if (!gpuGB) where = 'on the processor';
  let ctx = 4096;
  for (const [gb, n] of STEPS) if (room >= gb) { ctx = n; break; }
  if (ngl === 'auto') ctx = 8192;   // what llama.cpp's fitting is left to place
  if (native && native > 0) ctx = Math.min(ctx, native);
  return { nGpuLayers: ngl, ctxSize: Math.max(2048, ctx), where, fits: ngl === 999 };
}

/** A fit hint in words for the Models tab, before anything is downloaded. */
function hint(bytes, a = {}) {
  const p = plan({ bytes, gpuGB: a.gpuGB, gpuTotalGB: a.gpuTotalGB });
  const size = bytes / GB;
  if (p.fits) return { fits: true, one: p.where === 'on one graphics card', text: `fits ${p.where}` };
  if (a.ramGB && size * MARGIN + 2 > a.ramGB + (a.gpuTotalGB || 0)) return { fits: false, text: `too large for this machine (${size.toFixed(1)} GB)` };
  return { fits: null, text: a.gpuGB ? 'partly on the processor: slower' : 'on the processor: slow for a chat model' };
}

module.exports = { plan, hint };

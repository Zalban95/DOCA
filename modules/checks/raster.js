'use strict';

/**
 * Grey pictures as numbers (checks/): a PGM/PPM read, how much a picture varies (its contrast and how many edges it
 * has — a card that carries anything has edges), and a local threshold that turns text of any colour on any ground into
 * black on white for the OCR. Mechanical: arithmetic on pixels, no model.
 */

/** A binary PGM (P5) or PPM (P6) as {w, h, data} in grey, comments allowed in the header (Ghostscript writes one). */
function readPnm(buf) {
  const head = buf.toString('latin1', 0, Math.min(buf.length, 512));
  const m = head.match(/^P([56])\s+(?:#[^\n]*\n\s*)*(\d+)\s+(?:#[^\n]*\n\s*)*(\d+)\s+(?:#[^\n]*\n\s*)*(\d+)\s/);
  if (!m) throw new Error('not a PGM/PPM picture');
  const w = +m[2], h = +m[3], body = buf.subarray(m[0].length);
  if (m[1] === '5') return { w, h, data: body.subarray(0, w * h) };
  const data = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (body[i * 3] * 299 + body[i * 3 + 1] * 587 + body[i * 3 + 2] * 114) / 1000;
  return { w, h, data };
}

const toPgm = ({ w, h, data }) => Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), data]);

/**
 * How much there is to see: the mean and spread of grey, and edges per thousand pixels (a step of more than 24 grey
 * levels to the left or above). A blank or near-uniform card reads under one edge per thousand; a light model on a
 * white ground still reads several.
 */
function stats({ w, h, data }, offset = 0) {
  let s = 0, s2 = 0, e = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) { const v = data[offset + i]; s += v; s2 += v * v; }
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = offset + y * w + x;
    if (Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - w]) > 24) e++;
  }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), edges: 1000 * e / n };
}

/**
 * Text of any colour, black on white: a pixel is ink where it stands out from the mean of the square around it by more
 * than `c` grey levels — brighter (sign 1: light text on a dark or busy ground) or darker (sign -1).
 */
function threshold({ w, h, data }, { r = 20, c = 5, sign = 1 } = {}) {
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += data[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
  const out = Buffer.alloc(w * h, 255);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
      if (sign * (data[y * w + x] - mean) > c) out[y * w + x] = 0;
    }
  }
  return { w, h, data: out };
}

module.exports = { readPnm, toPgm, stats, threshold };

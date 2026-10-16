'use strict';

/**
 * Words on a picture and where they are (checks/): tesseract, given the picture twice — light text made black, then
 * dark text made black (raster.threshold), so text of any colour on any ground reads — and what the words say about
 * how the text was laid out. Two signs of text drawn badly, both found on a real promo video (2026-10-16):
 *   - doubled: the same run of words read twice at two places (a line drawn twice, offset; a ghost copy)
 *   - garbled: in a line read clearly, a word the OCR cannot make out at all — two texts drawn over each other
 * Mechanical: tesseract's boxes and confidences, compared by arithmetic. No model reads the picture.
 */
const raster = require('./raster');
const bin = require('./bin');

const alnum = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

async function words(pic) {
  const out = String(await bin.run('tesseract', ['stdin', '-', '--psm', '11', 'tsv'], { input: raster.toPgm(pic), timeoutMs: 30000 }));
  return out.split('\n').slice(1).map(l => l.split('\t')).filter(c => c.length >= 12 && c[11].trim() && Number(c[10]) >= 0)
    .map(c => ({ x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], t: c[11].trim() }));
}

/** Words grouped into lines: centres within half a word's height, heights alike; each line left to right. */
function lines(ws) {
  const out = [];
  for (const w of [...ws].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2;
    const line = out.find(l => Math.abs(l.cy - cy) < Math.max(l.h, w.h) / 2 && Math.max(l.h, w.h) / Math.max(1, Math.min(l.h, w.h)) < 1.8);
    if (line) line.words.push(w); else out.push({ cy, h: w.h, words: [w] });
  }
  for (const l of out) l.words.sort((a, b) => a.x - b.x);
  return out;
}

const good = w => w.conf >= 80 && alnum(w.t).length >= 2;
const score = ws => ws.filter(good).reduce((n, w) => n + alnum(w.t).length, 0);
const text = l => l.words.filter(w => w.conf >= 60).map(w => w.t).join(' ');

/** Both passes; `best` is the one that read the most clearly (the other mostly reads the first one's edges). */
async function read(pic) {
  const passes = [];
  for (const sign of [1, -1]) passes.push({ sign, words: await words(raster.threshold(pic, { sign })) });
  const best = passes.reduce((a, b) => (score(b.words) > score(a.words) ? b : a));
  return { passes, best, text: passes.flatMap(p => p.words.filter(w => w.conf >= 60).map(w => w.t)).join(' ') };
}

/** A word the OCR could not make out, between two it read clearly in one line: text over text. */
function garbled(best) {
  const found = [];
  for (const l of lines(best.words)) {
    const clear = l.words.filter(w => w.conf >= 85 && alnum(w.t).length >= 2);
    if (clear.length < 3) continue;
    const from = clear[0].x, to = clear[clear.length - 1].x;
    for (const w of l.words) if (w.conf < 45 && alnum(w.t).length >= 4 && w.x > from && w.x < to)
      found.push({ x: w.x, y: w.y, word: w.t, line: text(l) });
  }
  return found;
}

const same = (a, b) => { const x = alnum(a.t), y = alnum(b.t); return x.length >= 2 && y.length >= 2 && (x === y || x.startsWith(y) || y.startsWith(x)); };

/** Two words in a row, read again together somewhere else (moved by the same amount, beyond their own height). */
function doubled(passes) {
  const pairs = passes.flatMap(p => lines(p.words.filter(w => w.conf >= 75 && alnum(w.t).length >= 2))
    .flatMap(l => l.words.slice(1).map((b, i) => [l.words[i], b])));
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [a, b] = pairs[i], [c, d] = pairs[j];
    if (!same(a, c) || !same(b, d) || Math.max(alnum(a.t).length, alnum(b.t).length) < 3) continue;
    const dx = c.x - a.x, dy = c.y - a.y, h = Math.max(a.h, c.h);
    if (Math.abs((d.x - b.x) - dx) > h / 2 || Math.abs((d.y - b.y) - dy) > h / 2) continue;   // not the same shift
    if (Math.abs(dy) <= 1.2 * h && Math.abs(dx) <= 1.2 * (a.w + b.w)) continue;               // the same place, read twice
    return { words: `${a.t} ${b.t}`, at: [a.x, a.y], again: [c.x, c.y], dx, dy };
  }
  return null;
}

module.exports = { read, words, lines, garbled, doubled, alnum };

'use strict';

/**
 * A PDF as a person reading the sheet would see it (checks/, plan contract `{pdf, pages?, contains?, noOverlap?}`):
 *   - its pages (pdfinfo) and its text (pdftotext; a sheet whose text is drawn as lines is read by OCR instead)
 *   - `contains`: words that must be on it — a dimension, a title block's fields
 *   - laid out cleanly (on unless `noOverlap: false`): no text over other text, no line run through a word (the page
 *     drawn without its text by Ghostscript, inked where a word sits), nothing running off the sheet (ink at its edge)
 * A drawing with views over each other and leaders off the sheet passed as "a PDF exists" (2026-10-16); this fails it,
 * naming the page and the place in millimetres from the sheet's top left.
 */
const bin = require('./bin');
const raster = require('./raster');
const ocr = require('./ocr');

const MM = 25.4 / 72;
const mm = v => Math.round(v * MM);
const norm = t => String(t).toLowerCase().replace(/×/g, 'x').replace(/\s+/g, ' ');

function normalize(c, bad) {
  const out = { pdf: String(c.pdf).slice(0, 500) };
  if (c.pages !== undefined) { const n = Number(c.pages); if (!Number.isInteger(n) || n < 1 || n > 10000) throw bad('pages is a page count.'); out.pages = n; }
  if (c.contains !== undefined) {
    const list = (Array.isArray(c.contains) ? c.contains : [c.contains]).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 40);
    if (list.length) out.contains = list;
  }
  if (c.noOverlap === false) out.noOverlap = false;
  return out;
}

/** Every page's size and words, from pdftotext's boxes (points, top left). */
async function textLayer(file) {
  const x = String(await bin.run('pdftotext', ['-bbox', file, '-'], { timeoutMs: 60000 }));
  return [...x.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map(m => ({ w: +m[1], h: +m[2],
    words: [...m[3].matchAll(/<word xMin="([-\d.]+)" yMin="([-\d.]+)" xMax="([-\d.]+)" yMax="([-\d.]+)">([^<]*)<\/word>/g)]
      .map(w => ({ x0: +w[1], y0: +w[2], x1: +w[3], y1: +w[4], t: w[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') })) }));
}

/** A box's core: the font's ascent and descent take the top and bottom of pdftotext's box, so only the middle counts. */
const core = w => { const h = w.y1 - w.y0; return { x0: w.x0 + 0.5, x1: w.x1 - 0.5, y0: w.y0 + h * 0.3, y1: w.y1 - h * 0.25 }; };
const meets = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

function overlaps(page) {
  const out = [], cs = page.words.map(core);
  for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) if (meets(cs[a], cs[b])) out.push([page.words[a], page.words[b]]);
  return out;
}

const offPage = page => page.words.filter(w => w.x0 < -1 || w.y0 < -1 || w.x1 > page.w + 1 || w.y1 > page.h + 1);

/** Words a drawn line runs through: the page without its text, inked in a word's core. */
async function crossed(file, n, page) {
  const R = 100, pic = raster.readPnm(await bin.run('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dFILTERTEXT', '-sDEVICE=pgmraw', `-r${R}`,
    `-dFirstPage=${n}`, `-dLastPage=${n}`, '-sOutputFile=-', file], { timeoutMs: 60000 }));
  const k = pic.w / page.w, hits = [];
  for (const w of page.words) {
    const h = w.y1 - w.y0, X0 = Math.max(0, Math.round((w.x0 + 1) * k)), X1 = Math.min(pic.w, Math.round((w.x1 - 1) * k));
    const Y0 = Math.max(0, Math.round((w.y0 + h * 0.35) * k)), Y1 = Math.min(pic.h, Math.round((w.y1 - h * 0.3) * k));
    let ink = 0, all = 0;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { all++; if (pic.data[y * pic.w + x] < 128) ink++; }
    if (all && ink / all > 0.18) hits.push(w);
  }
  return hits;
}

/** The sides of the sheet where something is drawn right at its edge — cut off by the page. */
async function edges(file, n) {
  const pic = raster.readPnm(await bin.run('pdftoppm', ['-r', '40', '-gray', '-f', String(n), '-l', String(n), file], { timeoutMs: 60000 }));
  const band = Math.max(2, Math.round(Math.min(pic.w, pic.h) * 0.012)), side = { top: 0, bottom: 0, left: 0, right: 0 };
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
    if (pic.data[y * pic.w + x] > 160) continue;
    if (y < band) side.top++; if (y >= pic.h - band) side.bottom++; if (x < band) side.left++; if (x >= pic.w - band) side.right++;
  }
  return Object.keys(side).filter(k => side[k] > 3);
}

async function ocrPage(file, n) {
  const pic = raster.readPnm(await bin.run('pdftoppm', ['-r', '150', '-gray', '-f', String(n), '-l', String(n), file], { timeoutMs: 60000 }));
  return (await ocr.read(pic)).text;
}

const at = w => `"${w.t}" at ${mm(w.x0)},${mm(w.y0)} mm`;
const some = (list, f, n = 3) => `${list.slice(0, n).map(f).join(', ')}${list.length > n ? ` and ${list.length - n} more` : ''}`;

async function check(c, file) {
  let pages;
  try { pages = await textLayer(file); } catch (e) { return { ok: false, why: e.missing ? `could not read the PDF: ${e.message}` : `not a PDF poppler can read (${e.message})` }; }
  if (!pages.length) return { ok: false, why: 'it has no pages' };
  const problems = [], unverified = [], tidy = c.noOverlap !== false;
  if (c.pages && pages.length !== c.pages) problems.push(`it has ${pages.length} page${pages.length === 1 ? '' : 's'}, not ${c.pages}`);
  const words = pages.reduce((n, p) => n + p.words.length, 0);
  // Its text: the text layer, else what the OCR reads off the drawn pages (a CAD program may draw text as lines).
  let text = norm(pages.map(p => p.words.map(w => w.t).join(' ')).join(' '));
  if (!words) {
    if (bin.find('tesseract') && bin.find('pdftoppm')) {
      try { const read = []; for (let n = 1; n <= Math.min(pages.length, 6); n++) read.push(await ocrPage(file, n)); text = norm(read.join(' ')); }
      catch (e) { unverified.push(`its text (${e.message})`); }
    } else if (c.contains) unverified.push(`its text: it has no text layer, and reading the drawn text needs ${bin.find('tesseract') ? bin.missing('pdftoppm') : bin.missing('tesseract')}`);
  }
  if (!text.trim()) problems.push('no text could be read on it (no text layer, and none the OCR could make out)');
  const absent = (c.contains || []).filter(want => text.trim() && !text.includes(norm(want)));
  // Read off drawn lines, a miss may be the OCR's: said with what it did read, so the agent can tell which.
  if (absent.length) problems.push(`it does not show ${absent.map(w => `"${w}"`).join(', ')}${words ? '' : ` as far as the OCR can read its drawn text (it read: "${text.trim().slice(0, 160)}")`}`);
  if (tidy) {
    if (!words) unverified.push('text over text and lines through text (its text is drawn as lines, so there are no word boxes to compare)');
    for (let i = 0; i < pages.length && i < 30; i++) {
      const p = pages[i], n = i + 1, on = pages.length > 1 ? `page ${n}: ` : '';
      const off = offPage(p);
      if (off.length) problems.push(`${on}text runs off the page — ${some(off, at)}`);
      const over = overlaps(p);
      if (over.length) problems.push(`${on}text is drawn over other text in ${over.length} place${over.length === 1 ? '' : 's'} — ${some(over, ([a, b]) => `"${a.t}" over "${b.t}" at ${mm(a.x0)},${mm(a.y0)} mm`)}`);
      if (p.words.length && bin.find('gs')) {
        try { const hit = await crossed(file, n, p); if (hit.length) problems.push(`${on}a drawn line runs through ${hit.length} word${hit.length === 1 ? '' : 's'} — ${some(hit, at, 4)}`); }
        catch (e) { unverified.push(`${on}lines through text (${e.message})`); }
      } else if (p.words.length && i === 0) unverified.push(`lines through text — ${bin.missing('gs')}`);
      if (bin.find('pdftoppm')) {
        try { const cut = await edges(file, n); if (cut.length) problems.push(`${on}the drawing runs off the sheet at the ${cut.join(' and ')}`); }
        catch (e) { unverified.push(`${on}the sheet's edges (${e.message})`); }
      } else if (i === 0) unverified.push(`the sheet's edges — ${bin.missing('pdftoppm')}`);
    }
  }
  const tail = `${pages.length} page${pages.length === 1 ? '' : 's'}, ${mm(pages[0].w)}×${mm(pages[0].h)} mm, ${words ? `${words} words` : 'text drawn as lines'}`
    + `${unverified.length ? `; not verified: ${unverified.join('; ')}` : ''}`;
  return problems.length ? { ok: false, why: `${problems.join('; ')} (${tail})` } : { ok: true, why: tail };
}

module.exports = { normalize, check, textLayer, overlaps };

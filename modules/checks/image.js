'use strict';

/**
 * A picture as a person would see it (checks/, plan contract `{image, notBlank?, contains?, width?, height?}`): its size,
 * that it shows something (on unless `notBlank: false` — almost no edges and no contrast is a blank render or a card
 * with nothing on it), and words that must be on it, read by tesseract. Decoded by ffmpeg, which reads every common
 * picture format.
 */
const bin = require('./bin');
const raster = require('./raster');
const ocr = require('./ocr');
const { verdict } = require('./verdict');

function normalize(c, bad) {
  const out = { image: String(c.image).slice(0, 500) };
  for (const k of ['width', 'height']) if (c[k] !== undefined) { const n = Number(c[k]); if (!Number.isInteger(n) || n < 1) throw bad(`${k} is a size in pixels.`); out[k] = n; }
  if (c.notBlank === false) out.notBlank = false;
  if (c.contains !== undefined) {
    const list = (Array.isArray(c.contains) ? c.contains : [c.contains]).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 20);
    if (list.length) out.contains = list;
  }
  return out;
}

async function check(c, file) {
  let size;
  try {
    const j = JSON.parse(String(await bin.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { timeoutMs: 20000 })));
    size = j.streams?.[0];
  } catch (e) { return { ok: false, why: e.missing ? `could not look at the picture: ${e.message}` : `not a picture ffmpeg can read (${e.message})` }; }
  if (!size?.width) return { ok: false, why: 'not a picture ffmpeg can read' };
  const problems = [], unproven = [];
  if (c.width && size.width !== c.width) problems.push(`it is ${size.width} wide, not ${c.width}`);
  if (c.height && size.height !== c.height) problems.push(`it is ${size.height} high, not ${c.height}`);
  const w = Math.min(2400, size.width), h = Math.max(1, Math.round(w * size.height / size.width));
  const pic = raster.readPnm(await bin.run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'image2pipe', '-vcodec', 'pgm', '-'], { timeoutMs: 30000 }));
  // Blank or not is judged at the size the video check samples at, so a picture and a frame read alike.
  const small = raster.readPnm(await bin.run('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=480:${Math.max(2, Math.round(480 * size.height / size.width))},format=gray`, '-f', 'image2pipe', '-vcodec', 'pgm', '-'], { timeoutMs: 30000 }));
  const s = raster.stats(small);
  if (c.notBlank !== false && s.edges < 1 && s.sd < 12) problems.push(`it shows almost nothing (contrast ${s.sd.toFixed(1)}, ${s.edges.toFixed(1)} edges per thousand pixels)`);
  if (c.contains) {
    if (!bin.find('tesseract')) unproven.push(`its words — ${bin.missing('tesseract')}`);
    else {
      const read = (await ocr.read(pic)).text.toLowerCase();
      const absent = c.contains.filter(x => !read.includes(x.toLowerCase()));
      if (absent.length) problems.push(`the OCR does not find ${absent.map(x => `"${x}"`).join(', ')} on it (it read: "${read.slice(0, 120)}")`);
    }
  }
  return verdict({ problems, unproven, facts: `${size.width}×${size.height}, contrast ${s.sd.toFixed(1)}` });
}

module.exports = { normalize, check };

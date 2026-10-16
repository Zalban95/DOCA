'use strict';

/**
 * A video as a person would see it (checks/, plan contract `{video, duration?, width?, height?, fps?, frames?}`):
 *   - its facts, from ffprobe: length, size, frame rate — each compared with what the contract asks
 *   - no blank stretch: sampled twice a second, a second or more with almost no edges and no contrast is a card that
 *     shows nothing (a fade's single dark frame is not; a title card whose text is too faint to read is)
 *   - its text, where there is text (tesseract on `frames` frames, 16 by default): no line drawn twice, no text drawn
 *     over other text
 * A promo whose title card was near-blank and whose end text was doubled passed a brightness check (2026-10-16); this is
 * the check that fails it, saying at which second and where on the frame.
 */
const bin = require('./bin');
const raster = require('./raster');
const ocr = require('./ocr');

const SAMPLE_W = 480;   // the blank look's frames: small is enough to count edges
const BLANK = s => s.edges < 1 && s.sd < 12;

function normalize(c, bad) {
  const num = (k, lo, hi) => { if (c[k] === undefined) return {}; const v = Number(c[k]); if (!(v >= lo && v <= hi)) throw bad(`${k} is a number from ${lo} to ${hi}.`); return { [k]: v }; };
  return { video: String(c.video).slice(0, 500), ...num('duration', 0.1, 86400), ...num('width', 1, 16384), ...num('height', 1, 16384), ...num('fps', 1, 1000), ...num('frames', 1, 40) };
}

async function probe(file) {
  const j = JSON.parse(String(await bin.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,codec_name:format=duration', '-of', 'json', file], { timeoutMs: 30000 })));
  const s = j.streams?.[0];
  if (!s) return null;
  const rate = r => { const [a, b] = String(r || '').split('/').map(Number); return a > 0 && b > 0 ? a / b : null; };
  return { width: s.width, height: s.height, fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate), codec: s.codec_name,
    duration: Number(j.format?.duration) || null, frames: Number(s.nb_frames) || null };
}

/** Every half second, small and grey: [{t, mean, sd, edges}]. */
async function samples(file, f) {
  const h = Math.max(2, Math.round(SAMPLE_W * f.height / f.width / 2) * 2);
  const buf = await bin.run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=2,scale=${SAMPLE_W}:${h},format=gray`, '-f', 'rawvideo', '-'], { timeoutMs: 120000 });
  const n = Math.floor(buf.length / (SAMPLE_W * h)), out = [];
  for (let k = 0; k < n; k++) out.push({ t: k / 2, ...raster.stats({ w: SAMPLE_W, h, data: buf }, k * SAMPLE_W * h) });
  return out;
}

/** Stretches of a second or more that show nothing: [{from, to, sd, edges}]. */
function blanks(list) {
  const runs = [];
  let run = null;
  for (const s of list) {
    if (BLANK(s)) { run = run || { from: s.t, to: s.t, sd: 0, edges: 0, n: 0 }; run.to = s.t; run.sd += s.sd; run.edges += s.edges; run.n++; }
    else { if (run) runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  return runs.filter(r => r.to - r.from >= 1).map(r => ({ from: r.from, to: r.to + 0.5, sd: r.sd / r.n, edges: r.edges / r.n }));
}

async function frameAt(file, t, f) {
  const w = Math.min(1920, f.width), h = Math.round(w * f.height / f.width);
  return raster.readPnm(await bin.run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'image2pipe', '-vcodec', 'pgm', '-'], { timeoutMs: 30000 }));
}

const sec = t => `${Number(t).toFixed(1)} s`;

async function check(c, file) {
  const problems = [], unverified = [];
  let f;
  try { f = await probe(file); } catch (e) { return { ok: false, why: e.missing ? `could not look at the video: ${e.message}` : `not a video ffprobe can read (${e.message})` }; }
  if (!f) return { ok: false, why: 'it has no video stream' };
  const facts = `${sec(f.duration || 0)}, ${f.width}×${f.height}${f.fps ? `, ${Math.round(f.fps * 100) / 100} fps` : ''}`;
  if (c.duration && Math.abs((f.duration || 0) - c.duration) > Math.max(0.5, c.duration * 0.03)) problems.push(`it lasts ${sec(f.duration || 0)}, not ${sec(c.duration)}`);
  if (c.width && f.width !== c.width) problems.push(`it is ${f.width} wide, not ${c.width}`);
  if (c.height && f.height !== c.height) problems.push(`it is ${f.height} high, not ${c.height}`);
  if (c.fps && Math.abs((f.fps || 0) - c.fps) > 0.5) problems.push(`it runs at ${Math.round((f.fps || 0) * 100) / 100} fps, not ${c.fps}`);
  let list = [];
  try { list = await samples(file, f); } catch (e) { unverified.push(`blank stretches (${e.message})`); }
  for (const b of blanks(list)) problems.push(`${sec(b.from)}–${sec(Math.min(b.to, f.duration || b.to))} shows almost nothing (contrast ${b.sd.toFixed(1)}, ${b.edges.toFixed(1)} edges per thousand pixels): a card there carries no text a viewer can read`);
  // The text: frames spread over the video, the blank ones left out (they were said above).
  let looked = 0;
  if (!bin.find('tesseract')) unverified.push(`its text — ${bin.missing('tesseract')}`);
  else if (f.duration) {
    const n = c.frames || 16, twice = [], over = [];
    for (let k = 0; k < n; k++) {
      const t = Math.min(f.duration - 0.05, 0.25 + (f.duration - 0.5) * (n === 1 ? 0.5 : k / (n - 1)));
      const s = list[Math.min(list.length - 1, Math.round(t * 2))];
      if (s && BLANK(s)) continue;
      let r;
      try { r = await ocr.read(await frameAt(file, t, f)); } catch (e) { unverified.push(`the text at ${sec(t)} (${e.message})`); continue; }
      looked++;
      const d = ocr.doubled(r.passes);
      if (d) twice.push({ t, ...d });
      const g = ocr.garbled(r.best)[0];
      if (g) over.push({ t, ...g });
    }
    const also = list => (list.length > 1 ? ` (also at ${list.slice(1, 6).map(x => sec(x.t)).join(', ')})` : '');
    if (twice[0]) { const d = twice[0];
      problems.push(`at ${sec(d.t)} the words "${d.words}" appear twice — at (${d.at}) and again ${Math.abs(d.dx)} px ${d.dx < 0 ? 'left' : 'right'}, ${Math.abs(d.dy)} px ${d.dy < 0 ? 'up' : 'down'}: the text is drawn twice or has a ghost copy${also(twice)}`); }
    if (over[0]) { const g = over[0];
      problems.push(`at ${sec(g.t)} text is drawn over other text at (${g.x},${g.y}) px: in the line "${g.line.slice(0, 80)}" the OCR cannot make out "${g.word.slice(0, 30)}"${also(over)}`); }
  }
  const tail = `${facts}; ${list.length} moments sampled${looked ? `, text read on ${looked} frames` : ''}${unverified.length ? `; not verified: ${unverified.join('; ')}` : ''}`;
  return problems.length ? { ok: false, why: `${problems.join('; ')} (${tail})` } : { ok: true, why: tail };
}

module.exports = { normalize, check, probe, samples, blanks };

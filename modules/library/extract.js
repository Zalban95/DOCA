'use strict';

/**
 * One file into the pieces the Library embeds (docs/experiments/library.md), with a mechanical description — what the
 * file and the programs reading it say: name, size, duration, dimensions, the photo's date, the first words heard —
 * never a model's summary. A piece is `{kind, text?, image?, audio?, at?, end?}`:
 *
 *   text        a document's text, cut in overlapping pieces (retrieval/index.js chunks)
 *   image       a picture as the model takes it (JPEG through ffmpeg, else the file when it is PNG/JPEG/GIF/WebP)
 *   frame       a video frame every library.frameEverySec seconds, at most FRAMES
 *   audio       WINDOW seconds of sound as 16 kHz WAV, the first WINDOWS of them
 *   transcript  the words said, from the hub's speech-to-text, about WINDOW seconds a piece, with their times
 *   caption     one line from the vision model, only when the owner switched captions on (captions.js)
 *
 * What could not be read is a note, never a failure of the run.
 */
const fs = require('fs');
const path = require('path');
const M = require('./media');

const WINDOW = 30, WINDOWS = 20, FRAMES = 32;
const MAX_AUDIO_SEC = 4 * 3600;   // past four hours a recording's words are read for its first four
const MAX_RAW_IMAGE = 20 * 1024 * 1024;

const clock = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

/** The words said, in pieces of about WINDOW seconds with their start and end. */
function transcriptPieces(segments) {
  const out = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && s.start - last.at < WINDOW) { last.text += ` ${s.text}`; last.end = s.end; }
    else out.push({ kind: 'transcript', text: s.text, at: s.start, end: s.end });
  }
  return out;
}

async function sound(file, info, ctx, out) {
  const { signal, settings: st } = ctx;
  let samples = null;
  if (M.have().ffmpeg) {
    try { samples = await M.pcm(file, { seconds: MAX_AUDIO_SEC, signal }); } catch (e) { out.notes.push(`sound not read: ${e.message}`); }
  } else out.notes.push('sound not embedded: ffmpeg is not installed');
  if (samples?.length) {
    const secs = samples.length / 2 / M.RATE;
    out.meta.peaks = M.peaks(samples);
    for (let at = 0, n = 0; at < secs && n < WINDOWS; at += WINDOW, n++)
      out.pieces.push({ kind: 'audio', audio: M.wavOf(M.slice(samples, at, Math.min(secs, at + WINDOW))), at, end: Math.min(secs, at + WINDOW) });
    if (secs > WINDOW * WINDOWS) out.notes.push(`sound embedded for its first ${WINDOW * WINDOWS / 60} minutes; its words for all of it`);
  }
  if (!st.transcribe) return;
  try {
    const buf = samples?.length ? M.wavOf(samples) : info.size < 100 * 1024 * 1024 ? fs.readFileSync(file) : null;
    if (!buf) { out.notes.push('words not read: too large to send without ffmpeg'); return; }
    const t = await require('../stt').transcribeSegments(buf, samples?.length ? 'audio/wav' : 'application/octet-stream', samples?.length ? 'audio.wav' : path.basename(file), { signal });
    out.pieces.push(...transcriptPieces(t.segments));
    if (t.text) out.meta.words = t.text.split(/\s+/).slice(0, 24).join(' ');
    if (t.language) out.meta.language = t.language;
  } catch (e) { if (e.name === 'AbortError') throw e; out.notes.push(`words not read: ${e.message}`); }
}

async function maybeCaption(jpeg, ctx, out) {
  const C = require('./captions');
  if (!jpeg || !C.ready() || ctx.captions.left <= 0) return;
  ctx.captions.left--;
  try {
    const line = await C.caption(jpeg, ctx.signal);
    ctx.captions.written++;
    if (line) { out.meta.caption = line; out.pieces.push({ kind: 'caption', text: line }); }
  } catch (e) { if (e.name === 'AbortError') throw e; out.notes.push(`caption not written: ${e.message}`); }
}

async function image(file, info, ctx, out) {
  const { signal } = ctx;
  const pr = await M.probe(file, signal);
  let jpeg = null;
  if (M.have().ffmpeg) { try { jpeg = await M.picture(file, { signal }); } catch (e) { out.notes.push(`picture not read: ${e.message}`); } }
  let raw = null;
  if (!jpeg && info.size <= MAX_RAW_IMAGE) { raw = fs.readFileSync(file); if (!M.takenImage(raw)) { out.notes.push('picture not read: this format needs ffmpeg'); raw = null; } }
  const dims = pr.width ? { width: pr.width, height: pr.height } : raw ? M.headerSize(raw) : {};
  Object.assign(out.meta, dims);
  const date = await M.photoDate(file, signal);
  if (date) out.meta.date = date;
  if (jpeg || raw) out.pieces.push({ kind: 'image', image: jpeg || raw });
  await maybeCaption(jpeg || raw, ctx, out);
}

async function video(file, info, ctx, out) {
  const { signal, settings: st } = ctx;
  const pr = await M.probe(file, signal);
  Object.assign(out.meta, { duration: pr.duration ?? null, ...(pr.width ? { width: pr.width, height: pr.height } : {}) });
  if (!M.have().ffmpeg) { out.notes.push('frames not read: ffmpeg is not installed'); }
  else if (pr.video !== false) {
    const dur = pr.duration || 0, every = Math.max(st.frameEverySec, dur / FRAMES);
    const times = [];
    for (let t = Math.min(1, dur / 2); t < Math.max(dur, 0.1) && times.length < FRAMES; t += every) times.push(Math.round(t * 10) / 10);
    let middle = null;
    for (const at of times) {
      try {
        const jpeg = await M.picture(file, { at, size: 640, signal });
        if (jpeg.length) { out.pieces.push({ kind: 'frame', image: jpeg, at, end: Math.min(dur || at, at + every) }); if (!middle || at <= dur / 2) middle = jpeg; }
      } catch (e) { if (e.name === 'AbortError') throw e; out.notes.push(`a frame at ${clock(at)} not read`); }
    }
    await maybeCaption(middle, ctx, out);
  }
  if (pr.audio !== false) await sound(file, info, ctx, out);
}

async function audio(file, info, ctx, out) {
  const pr = await M.probe(file, ctx.signal);
  if (pr.video && path.extname(file).toLowerCase() === '.webm') { out.kind = 'video'; return video(file, info, ctx, out); }
  out.meta.duration = pr.duration ?? null;
  return sound(file, info, ctx, out);
}

async function documents(file, info, ctx, out) {
  const { text, note } = await require('./docs').text(file, ctx.signal);
  if (note) out.notes.push(note);
  const chunks = require('../retrieval').chunks(text).slice(0, 40);
  out.pieces.push(...chunks.map(t => ({ kind: 'text', text: t })));
  if (chunks.length) out.meta.words = text.trim().split(/\s+/).slice(0, 24).join(' ');
}

/** The one line a person reads about a file, made of what was measured. */
function about(name, kind, meta, size) {
  const mb = size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  return [name, kind, mb, meta.duration ? clock(meta.duration) : '', meta.width ? `${meta.width}×${meta.height}` : '',
    meta.date ? `taken ${meta.date}` : '', meta.words ? `“${meta.words.slice(0, 120)}…”` : ''].filter(Boolean).join(' · ');
}

/** `{kind, meta, pieces, notes, about}` for one file of the walk. */
async function extract(info, ctx) {
  const out = { kind: info.kind, meta: {}, pieces: [], notes: [] };
  await ({ documents, images: image, audio, video })[info.kind](info.path, info, ctx, out);
  out.about = about(path.basename(info.path), out.kind, out.meta, info.size);
  return out;
}

module.exports = { extract, transcriptPieces, about, clock, WINDOW, WINDOWS, FRAMES };

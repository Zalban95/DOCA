'use strict';

/**
 * The programs the Library reads media and documents with — whichever this machine has, found on PATH in process
 * (shell.which: no login shell) and run by argv, never through a shell, so a file's name is never a shell word.
 * ffmpeg/ffprobe for sound, frames and pictures; pdftotext for PDF; LibreOffice for office files; exiftool for a
 * photo's date. What is missing is said by `have()` and by the Library section, and the kind that needs it reads
 * less (a note on the file) rather than failing the run.
 */
const { execFile } = require('child_process');

const TOOLS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', pdftotext: 'pdftotext', soffice: 'soffice', exiftool: 'exiftool' };
let _have = null, _at = 0;

/** Which of the programs are here (kept a minute). */
function have() {
  if (_have && Date.now() - _at < 60000) return _have;
  const which = require('../shell').which;
  _have = Object.fromEntries(Object.entries(TOOLS).map(([k, bin]) => [k, !!which(bin) || (k === 'soffice' && !!which('libreoffice'))]));
  _at = Date.now();
  return _have;
}
const sofficeBin = () => (require('../shell').which('soffice') ? 'soffice' : 'libreoffice');

/** Run a program by argv; stdout as a Buffer. */
function run(bin, args, { timeoutMs = 120000, maxBuffer = 256 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'buffer', timeout: timeoutMs, maxBuffer, signal, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout, stderr) => (err ? reject(Object.assign(new Error(`${bin}: ${String(stderr || err.message).trim().split('\n').pop().slice(0, 200)}`), { cause: err })) : resolve(stdout)));
  });
}

/** Duration, dimensions and whether there is sound and picture, from ffprobe; {} without it. */
async function probe(file, signal) {
  if (!have().ffprobe) return {};
  try {
    const j = JSON.parse((await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30000, signal })).toString());
    const v = (j.streams || []).find(s => s.codec_type === 'video' && !(s.disposition || {}).attached_pic);
    const a = (j.streams || []).find(s => s.codec_type === 'audio');
    const dur = Number(j.format?.duration);
    return { duration: Number.isFinite(dur) ? Math.round(dur * 10) / 10 : null, width: v?.width || null, height: v?.height || null, video: !!v, audio: !!a };
  } catch { return {}; }
}

/** A file's sound as raw 16 kHz mono 16-bit samples (what the model's feature extractor reads), at most `seconds`. */
async function pcm(file, { seconds = null, signal } = {}) {
  return run('ffmpeg', ['-v', 'error', '-i', file, ...(seconds ? ['-t', String(seconds)] : []), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'],
    { timeoutMs: 600000, signal });
}
const RATE = 16000;

/** Samples as a WAV file (the header written here, so a slice of the samples is a whole file). */
function wavOf(samples) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + samples.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(samples.length, 40);
  return Buffer.concat([h, samples]);
}
/** `[from, to)` seconds of samples. */
const slice = (samples, from, to) => samples.subarray(Math.floor(from * RATE) * 2, Math.floor(to * RATE) * 2);

/** A waveform to draw: the loudest sample of each of `n` stretches, 0–100. */
function peaks(samples, n = 48) {
  const count = Math.floor(samples.length / 2);
  if (!count) return [];
  const step = Math.max(1, Math.floor(count / n)), out = [];
  for (let i = 0; i < n && i * step < count; i++) {
    let m = 0;
    for (let k = i * step; k < Math.min(count, (i + 1) * step); k += 8) m = Math.max(m, Math.abs(samples.readInt16LE(k * 2)));
    out.push(Math.round((m / 32768) * 100));
  }
  return out;
}

/** A picture as a JPEG no larger than `size` px on its longer side (any format ffmpeg reads). */
async function picture(file, { at = null, size = 896, signal } = {}) {
  return run('ffmpeg', ['-v', 'error', ...(at != null ? ['-ss', String(at)] : []), '-i', file, '-frames:v', '1',
    '-vf', `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=decrease`, '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'], { timeoutMs: 60000, signal });
}

/** A photo's own date (EXIF DateTimeOriginal or CreateDate), from exiftool; null without it. */
async function photoDate(file, signal) {
  if (!have().exiftool) return null;
  try {
    const out = (await run('exiftool', ['-s3', '-d', '%Y-%m-%d %H:%M', '-DateTimeOriginal', '-CreateDate', file], { timeoutMs: 20000, signal })).toString().trim().split('\n')[0];
    return /^\d{4}-\d{2}-\d{2}/.test(out) ? out : null;
  } catch { return null; }
}

/** Width and height read from a PNG, GIF or JPEG header, for when there is no ffprobe. */
function headerSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return {};
}

/** What the model takes as a picture as it is (Ollama sniffs these). */
const takenImage = buf => buf.length > 12 && (buf.readUInt32BE(0) === 0x89504e47 || (buf[0] === 0xff && buf[1] === 0xd8)
  || buf.toString('ascii', 0, 3) === 'GIF' || (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'));

module.exports = { have, run, probe, pcm, wavOf, slice, peaks, RATE, picture, photoDate, headerSize, takenImage, sofficeBin, _reset: () => { _have = null; } };

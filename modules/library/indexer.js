'use strict';

/**
 * Bringing the Library's index up to date (docs/experiments/library.md): one run at a time, one file at a time, and
 * only while the machine is not busy. A file whose size and modified time match its row is skipped; one whose content
 * hash matches only has its time updated; what is new or changed is read (extract.js), embedded, tagged and stored;
 * what is gone — or in a folder no longer chosen — is removed. Stopping keeps everything done so far, so the next
 * run resumes. The run is one activity line when it starts and one when it ends (CONSTITUTION §1), and its progress
 * is the Library section's bar.
 */
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const S = require('./store');
const E = require('./embed');

const FULL_HASH_MAX = 256 * 1024 * 1024, SAMPLE = 4 * 1024 * 1024;
let _run = null;      // {ctrl, state}
let _last = null;     // the last run's state, for the section

const sc = () => require('../settings-schema');
function settings() {
  const v = k => sc().value(`library.${k}`);
  return { folders: v('folders'), kinds: v('kinds'), maxFiles: v('maxFiles'), maxPieces: v('maxPieces'), frameEverySec: v('frameEverySec'),
    transcribe: v('transcribe'), maxFileMB: v('maxFileMB'), idleLoad: v('idleLoad'), captionsPerRun: v('captionsPerRun') };
}
const on = () => require('../experiments').on('library') && !!E.settings().model;

/** sha256 of the file — of its first, middle and last 4 MB with its size when it is larger than 256 MB. */
function hashOf(file, size) {
  const h = crypto.createHash('sha256');
  if (size <= FULL_HASH_MAX) {
    const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
    try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
    return h.digest('hex').slice(0, 32);
  }
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(SAMPLE);
  try { for (const at of [0, Math.floor(size / 2), size - SAMPLE]) h.update(buf.subarray(0, fs.readSync(fd, buf, 0, SAMPLE, at))); } finally { fs.closeSync(fd); }
  return `s-${h.update(String(size)).digest('hex').slice(0, 30)}`;
}

const sleep = (ms, signal) => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

/** Wait while the machine is busy (load per core over library.idleLoad); says so in the state. */
async function idle(st, limit, signal) {
  const cores = os.cpus().length || 1;
  while (!signal.aborted && os.loadavg()[0] / cores > limit) { st.waiting = true; await sleep(5000, signal); }
  st.waiting = false;
}

/** Embed a file's pieces: text pieces with the card's document prefix, pictures and sound as they are. */
async function embedPieces(name, pieces, cfg, signal) {
  const asks = pieces.map(p => (p.image ? { image: p.image } : p.audio ? { audio: p.audio } : { text: E.docText(cfg.model, name, p.text) }));
  const vecs = await E.embed(asks, cfg, signal);
  pieces.forEach((p, i) => { p.vec = vecs[i]; });
  return pieces.filter(p => p.vec);
}

async function one(f, have, ctx) {
  const { cfg, st, signal } = ctx;
  const old = have.get(f.path);
  if (old && old.size === f.size && old.mtimeMs === f.mtimeMs && old.model === cfg.model && old.state !== 'failed') return 'same';
  if (f.size > st.settings.maxFileMB * 1048576) {
    await S.put({ ...f, state: 'skipped', note: `larger than ${st.settings.maxFileMB} MB (library.maxFileMB)` }, []);
    return 'skipped';
  }
  const hash = hashOf(f.path, f.size);
  if (old && old.hash === hash && old.model === cfg.model && old.state !== 'failed') { await S.touch(f.path, f.mtimeMs); return 'same'; }
  const name = require('path').basename(f.path);
  const x = await require('./extract').extract(f, { signal, settings: st.settings, captions: ctx.captions });
  let pieces = x.pieces.filter(p => p.text || p.image || p.audio);
  const room = st.settings.maxPieces - ctx.pieces;
  if (pieces.length > room) {
    pieces = pieces.slice(0, Math.max(0, room));
    x.notes.push(`the index is full (library.maxPieces ${st.settings.maxPieces})`);
  }
  pieces = pieces.length ? await embedPieces(name, pieces, cfg, signal) : [];
  if (x.pieces.some(p => p.image || p.audio) && cfg.dialect !== 'ollama') x.notes.push('pictures and sound not embedded: the endpoint takes text only (dialect openai)');
  try { x.meta.tags = require('./tags').label(pieces, await require('./tags').vectors(cfg, signal)); } catch (e) { if (e.name === 'AbortError') throw e; }
  ctx.pieces += pieces.length;
  const meta = { ...x.meta, about: x.about };
  await S.put({ ...f, kind: x.kind, hash, model: cfg.model, state: pieces.length ? (x.notes.length ? 'partial' : 'done') : 'unread', note: x.notes.join('; ') || null, meta }, pieces.map(p => ({ ...p, image: undefined, audio: undefined })), cfg.model);
  return 'read';
}

/** Start a run (`why`: demand, schedule, watch); refused while one runs or while the Library is off. */
function start({ why = 'demand', person = null } = {}) {
  if (!require('../experiments').on('library')) throw Object.assign(new Error('The Library experiment is off (Settings → Developer).'), { status: 409 });
  if (!E.settings().model) throw Object.assign(new Error('No embedding model is set for the Library (Field → Models → Library).'), { status: 409 });
  if (_run) throw Object.assign(new Error('The Library is already indexing.'), { status: 409 });
  const st = { running: true, why, startedAt: new Date().toISOString(), phase: 'listing', total: 0, done: 0, read: 0, removed: 0, failed: 0, skipped: 0, current: null, waiting: false, error: null,
    settings: settings(), captions: 0 };
  const ctrl = new AbortController();
  _run = { ctrl, st };
  go(st, ctrl.signal, person).catch(e => { st.error = e.message; }).finally(() => {
    st.running = false; st.finishedAt = new Date().toISOString(); st.current = null; _last = st; _run = null;
    require('../activity').note({ from: 'library', what: `indexed ${st.read} file${st.read === 1 ? '' : 's'}, removed ${st.removed}, ${st.failed} failed${st.error ? ` — stopped: ${st.error}` : ''}`,
      why: st.stopped ? 'stopped by a person' : 'the run ended', level: st.error ? 'warn' : 'info', person });
    require('../live').changed('library', 'run', 'ended');
  });
  return view();
}

async function go(st, signal, person) {
  const cfg = E.settings();
  const { files, over } = require('./scan').walk(st.settings.folders, { kinds: st.settings.kinds, max: st.settings.maxFiles });
  st.total = files.length; st.over = over;
  require('../activity').note({ from: 'library', what: `indexing ${files.length} file${files.length === 1 ? '' : 's'} in ${st.settings.folders.length} folder${st.settings.folders.length === 1 ? '' : 's'}${over ? ` (${over} past library.maxFiles)` : ''}`,
    why: st.why === 'demand' ? 'asked in the Library section' : st.why === 'schedule' ? 'its schedule (library.everyHours)' : 'a watched folder changed', person });
  const have = new Map((await S.items()).map(r => [r.path, r]));
  const seen = new Set(files.map(f => f.path));
  st.removed = await S.remove([...have.keys()].filter(p => !seen.has(p)));
  const ctx = { cfg, st, signal, pieces: await S.pieceCount(), captions: { left: st.settings.captionsPerRun, written: 0 } };
  st.phase = 'reading';
  let failedInARow = 0;
  for (const f of files) {
    if (signal.aborted) break;
    await idle(st, st.settings.idleLoad, signal);
    st.current = f.path;
    try {
      const r = await one(f, have, ctx);
      if (r === 'read') st.read++; else if (r === 'skipped') st.skipped++;
      failedInARow = 0;
    } catch (e) {
      if (e.name === 'AbortError' || signal.aborted) break;
      st.failed++;
      await S.put({ ...f, state: 'failed', note: String(e.message).slice(0, 300) }, []).catch(() => {});
      // The model's endpoint gone is not this file's fault: three in a row stop the run instead of failing every file.
      if (++failedInARow >= 3 && e.status === 502) throw e;
    }
    st.done++;
    st.captions = ctx.captions.written;
    if (st.done % 5 === 0 || st.done === st.total) require('../live').changed('library', 'run', 'progress');
  }
  st.phase = signal.aborted ? 'stopped' : 'done';
}

function stop() {
  if (!_run) return view();
  _run.st.stopped = true;
  _run.ctrl.abort();
  return view();
}

const running = () => !!_run;
/** The run in progress, else the last one; never a file's content. */
function view() { const st = _run?.st || _last; return st ? { ...st, settings: undefined } : null; }

module.exports = { start, stop, running, view, on, hashOf, settings, _reset: () => { _last = null; } };

'use strict';

/**
 * A person's own recordings for a wake word, labelled by what they were asked to say — not by a transcript: a
 * transcriber that has never heard the word writes "docker" for some of the person's "doca"s (seen 2026-10-06), so
 * transcripts cannot label them. "Say the word, a few times, with pauses" gives clips of the word; "now say other
 * things — near words, a sentence" gives clips that must not wake. Each recording is split into utterances by its
 * pauses (trainers/wakeword/segments.py) and kept under samples/<word>/{word,other}/. A recording can also come from the
 * chat's voice messages (attachments). The originals are kept beside them, in raw/.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ww = require('./index');

const KINDS = ['word', 'other'];
const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });

function folder(word, kind) {
  const name = ww.slug(word);
  if (!name || name.length < 3) throw bad('A wake word of at least three letters.');
  if (!KINDS.includes(kind)) throw bad('kind: word (the word) or other (what must not wake it).');
  return { name, dir: path.join(ww.dir(), 'samples', name, kind), raw: path.join(ww.dir(), 'samples', name, 'raw') };
}

/** Split one recording into utterances; resolves with how many it made. Needs the trainer's environment and ffmpeg. */
function split(file, outDir) {
  if (!fs.existsSync(ww.python())) return Promise.reject(bad('Set up the trainer first: its environment splits recordings.', 409));
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve, reject) => execFile(ww.python(), [path.join(ww.TRAINER, 'segments.py'), outDir, file], { timeout: 120000, windowsHide: true },
    (e, out, err) => (e ? reject(bad(`Could not split the recording: ${String(err || e.message).trim().split('\n').pop()} (ffmpeg is in System tools)`, 500))
      : resolve(String(out).trim().split('\n').filter(Boolean).length))));
}

/** A recording sent from the panel (the request body, any audio format ffmpeg reads). */
async function add(word, kind, buffer, type = '') {
  const { dir, raw } = folder(word, kind);
  if (!buffer?.length) throw bad('No audio in the request.');
  fs.mkdirSync(raw, { recursive: true });
  const ext = /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'm4a' : 'webm';
  const file = path.join(raw, `${kind}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  return { made: await split(file, dir), ...counts(word) };
}

/** Voice messages already in the chat (attachments named voice-…), labelled as the person says. */
async function importFrom(word, kind, names = []) {
  const { dir } = folder(word, kind);
  const att = require('../attachments');
  let made = 0;
  for (const n of [].concat(names).slice(0, 50)) {
    const p = path.join(att.dir(), path.basename(String(n)));
    if (!/^voice-/.test(path.basename(p)) || !fs.existsSync(p)) throw bad(`No voice message called ${n}.`, 404);
    made += await split(p, dir);
  }
  return { made, ...counts(word) };
}

function counts(word) {
  const name = ww.slug(word), n = k => { try { return fs.readdirSync(path.join(ww.dir(), 'samples', name, k)).length; } catch { return 0; } };
  return { word: name, said: n('word'), other: n('other') };
}

function clear(word, kind) {
  const { dir } = folder(word, kind);
  fs.rmSync(dir, { recursive: true, force: true });
  return counts(word);
}

/** The chat's voice messages, newest first, for the "from the chat" picker. */
function voiceMessages() {
  return require('../attachments').list().filter(a => /^voice-/.test(a.name)).slice(0, 30).map(a => ({ name: a.name, at: a.at || a.mtime || null, bytes: a.bytes }));
}

module.exports = { add, importFrom, counts, clear, voiceMessages, KINDS };

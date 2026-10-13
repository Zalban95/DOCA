'use strict';

/**
 * Meeting notes (R6; docs/design/meeting-notes.md, asked 2026-10-12): what was said, kept and written up — only for those
 * who said yes.
 *
 *   Consent    "Take notes" asks everyone in the room; each answers for themselves. A "Not me" is final for this meeting:
 *              that person's audio is never transcribed (their page sends none, and the hub refuses any). Leaving the
 *              meeting withdraws one's yes for the rest of it. Stopping is one click for whoever started.
 *   Hearing    each consenting page sends its own microphone, an utterance at a time, to the hub's speech-to-text: a
 *              line is always a person's, named by their account — never the mixed room.
 *   Notes      each person's own shorthand, kept as they type; "Write it up" turns each line into a sentence from the
 *              transcript around it (the person's model, no tools), kept beside what they typed and marked as written.
 *   Record     when the room closes: the transcript, the notes, the written-up lines and the chat, as markdown in the
 *              meeting's folder (DATA_DIR/meetings/<id>/notes.md), read by its people only.
 * In memory while the room is open, like the room; the record is what stays. Mechanical apart from "Write it up".
 */
const fs = require('fs');
const path = require('path');

const notes = new Map();   // room id → { by, byName, startedAt, on, consent: Map(person → 'yes'|'no'), lines: [], mine: Map, written: Map }
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const rooms = () => require('./rooms');
const tell = (id, what, extra = {}) => require('../live').changed('meeting', id, what, extra);
const KEEP_LINES = 4000;

function state(id) { return notes.get(id) || null; }

/** What a person sees of the notes now. */
function view(id, person) {
  const n = state(id);
  if (!n) return { on: false };
  const answers = [...n.consent.values()];
  return { on: n.on, by: n.byName, startedAt: n.startedAt, mine: n.mine.get(person.id) || '', written: n.written.get(person.id) || [],
    consent: n.consent.get(person.id) || null, agreed: answers.filter(a => a === 'yes').length, asked: rooms().snapshot(id)?.peers.length || answers.length,
    lines: n.lines.slice(-400) };
}

function start(id, person, screen) {
  rooms().peerOf(id, screen);   // only from a page in the meeting
  const was = state(id);
  if (was?.on) return view(id, person);
  const n = was || { consent: new Map(), lines: [], mine: new Map(), written: new Map(), chat: [] };
  Object.assign(n, { by: person.id, byName: person.name, startedAt: new Date().toISOString(), on: true });
  if (!n.consent.has(person.id)) n.consent.set(person.id, 'yes');   // who starts them agrees for themselves
  notes.set(id, n);
  tell(id, 'notes', { on: true, by: person.name });   // every page asks its person (meet/notes.js)
  require('../activity').note({ from: 'meetings', what: `${person.name} started notes in a meeting`, why: 'everyone in it is asked; only who says yes is transcribed', person: { id: person.id, name: person.name } });
  return view(id, person);
}

function consent(id, person, answer) {
  const n = state(id);
  if (!n?.on) throw bad('Notes are not being taken in this meeting.', 409);
  if (n.consent.get(person.id) === 'no') return view(id, person);   // a no stays a no for this meeting
  n.consent.set(person.id, answer === 'yes' ? 'yes' : 'no');
  tell(id, 'notes', { on: true, consent: true });
  return view(id, person);
}

function stop(id, person) {
  const n = state(id);
  if (!n?.on) return { on: false };
  if (n.by !== person.id) throw bad(`Notes are stopped by who started them (${n.byName}).`, 403);
  n.on = false;
  tell(id, 'notes', { on: false });
  return view(id, person);
}

/** One utterance from a person's own page: transcribed only when they said yes and notes are on. */
async function heard(id, person, screen, file) {
  rooms().peerOf(id, screen);
  const n = state(id);
  if (!n?.on) throw bad('Notes are not being taken in this meeting.', 409);
  if (n.consent.get(person.id) !== 'yes') throw bad('You have not agreed to be noted in this meeting: nothing you say is transcribed.', 403);
  if (!file?.buffer?.length) throw bad('No audio.');
  const r = await require('../stt').transcribeHeard(file.buffer, file.mimetype || 'audio/webm', file.originalname || 'utterance.webm');
  const text = String(r.text || '').trim();
  if (!text) return { line: null };
  const line = { at: new Date().toISOString(), personId: person.id, name: person.name, text: text.slice(0, 2000), language: r.language || null };
  n.lines.push(line); if (n.lines.length > KEEP_LINES) n.lines.splice(0, n.lines.length - KEEP_LINES);
  tell(id, 'notes-line', { line });
  // A question said aloud: answered on the asker's own page, from what they may open (notes-answers.js) — not awaited.
  require('./notes-answers').answer(id, person, line).catch(() => {});
  return { line };
}

function mine(id, person, text) {
  const n = state(id);
  if (!n) throw bad('No notes in this meeting yet: Take notes starts them.', 409);
  n.mine.set(person.id, String(text || '').slice(0, 20000));
  return { saved: true };
}

/** "Write it up": each line of the person's shorthand becomes a sentence from the transcript, with the person's model. */
async function writeUp(id, person) {
  const n = state(id);
  if (!n) throw bad('No notes in this meeting yet.', 409);
  const short = (n.mine.get(person.id) || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 60);
  if (!short.length) throw bad('Write a few words first — each line becomes a sentence.');
  const transcript = n.lines.map(l => `[${l.at.slice(11, 16)}] ${l.name}: ${l.text}`).join('\n').slice(-16000);
  const meeting = rooms().snapshot(id);
  const system = 'You write meeting notes. For each numbered shorthand line, write one or two plain sentences that say what it means, using only the transcript. '
    + 'If the transcript does not support a line, say so in the sentence. Answer with the numbered lines only, one per number, in the language of the shorthand.';
  const user = `Meeting: ${meeting?.title || 'a meeting'}\nPeople: ${(meeting?.peers || []).map(p => p.name).join(', ')}\n\nTranscript:\n${transcript || '(nothing transcribed)'}\n\nShorthand:\n${short.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
  const reply = String(await require('../harness/turn/transport').ask({ system, user, temperature: 0.2, person: { id: person.id, role: person.role } }) || '');
  const out = short.map((line, i) => {
    const m = new RegExp(`^\\s*${i + 1}[.)]\\s*(.+)$`, 'm').exec(reply);
    return { line, text: (m ? m[1] : '').trim() || '(no sentence came back for this line)', written: true };
  });
  n.written.set(person.id, out);
  return { written: out };
}

/** A person left: their yes ends for the rest of this meeting. */
function left(id, personId) { const n = state(id); if (n?.consent.get(personId) === 'yes') n.consent.set(personId, 'no'); }

const dir = id => path.join(require('../store').DATA_DIR, 'meetings', String(id).replace(/[^\w-]/g, ''));

/** The room closed: the record, as markdown, in the meeting's folder. Nothing written when no notes were taken. */
function record(id, title) {
  const n = state(id);
  notes.delete(id);
  if (!n) return null;
  const agreed = [...n.consent.values()].filter(a => a === 'yes').length;
  const md = [`# ${title || 'Meeting'} — notes`, '', `Started by ${n.byName}, ${n.startedAt.slice(0, 16).replace('T', ' ')} UTC. ${agreed} agreed to be noted; nobody else was transcribed.`, ''];
  md.push('## What was said', '', ...(n.lines.length ? n.lines.map(l => `- **${l.name}** (${l.at.slice(11, 16)}): ${l.text}`) : ['(nothing transcribed)']), '');
  for (const [pid, text] of n.mine) {
    const who = n.lines.find(l => l.personId === pid)?.name || (pid === n.by ? n.byName : 'Someone');
    md.push(`## ${who}'s notes`, '', text || '(empty)', '');
    const w = n.written.get(pid);
    if (w?.length) md.push('### Written up from the transcript (by the model)', '', ...w.map(x => `- ${x.line} → ${x.text}`), '');
  }
  const chat = n.chat;   // kept while the notes ran: the room is gone when it ends
  if (chat.length) md.push('## Chat', '', ...chat.map(c => `- **${c.name}** (${c.at.slice(11, 16)}): ${c.text}`), '');
  fs.mkdirSync(dir(id), { recursive: true });
  const file = path.join(dir(id), 'notes.md');
  fs.writeFileSync(file, md.join('\n'));
  return file;
}

function readRecord(id) { const f = path.join(dir(id), 'notes.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }
const hasRecord = id => fs.existsSync(path.join(dir(id), 'notes.md'));

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  const ev = rooms().events;
  ev.on('left', ({ roomId, personId }) => left(roomId, personId));
  ev.on('said', ({ roomId, line }) => { const n = state(roomId); if (n?.on) n.chat.push(line); });
  ev.on('ended', ({ roomId, title }) => { try { record(roomId, title); } catch (e) { console.error('[meetings] notes record failed:', e.message); } });
}

module.exports = { view, start, consent, stop, heard, mine, writeUp, record, readRecord, hasRecord, hook, left, _notes: notes };

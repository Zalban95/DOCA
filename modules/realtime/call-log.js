'use strict';

/**
 * Every live call says how each of its stages went (asked 2026-10-08: "the live call is not working … it fails
 * silently"). A call that heard nothing, a transcript that came back empty, a turn cut short and an answer that was
 * never spoken all looked the same — a quiet call — and nothing on the hub said which it was.
 *
 * One record per call, in memory: the audio that arrived (bytes, frames, the loudest level, the room's floor), the
 * utterances found and dropped, what the transcriber said of each (words counted, never the words; an empty answer and
 * the silence phrase screened out, by name), the turns started and how each ended, the sentences spoken, the notices sent
 * to the caller, and why the call closed. Each stage is also a line in a ring (`logs.callLines`, log-keep.js), read by
 * Hub → Logs as the source `call` and by Chronicle as the source `call`.
 *
 * What a line carries is names and numbers. A person's words stay in their conversation, under its rules; the only
 * words here are the screened silence phrases, which are the transcriber's, not the person's.
 */
const MAX_CALLS = 20;

const ring = [];
const calls = new Map();   // id → record, the newest MAX_CALLS
let seq = 0;

const ringMax = () => { try { return require('../log-keep').limit('logs.callLines'); } catch { return 500; } };
const listeners = new Set();

function push(rec, level, text) {
  const l = { ts: new Date().toISOString(), source: 'call', label: 'Calls', level, text: `${rec.label} · ${text}`,
    sessionId: rec.sessionId || null, callId: rec.id, personId: rec.personId || null };
  ring.push(l);
  const max = ringMax();
  if (ring.length > max) ring.splice(0, ring.length - max);
  for (const fn of listeners) { try { fn(l); } catch { /* a reader gone */ } }
  return l;
}

/**
 * A call begins. `kind` is `device` (the wire of /api/v1/call) or `panel` (the panel's own call, which reports its
 * stages from the page); `label` names who is calling. Returns the record's handle.
 */
function begin({ kind = 'device', label = 'a call', sessionId = null, person = null, deviceId = null, engine = null } = {}) {
  const id = `call_${Date.now().toString(36)}${(++seq).toString(36)}`;
  const rec = { id, kind, label: String(label).slice(0, 80), sessionId, personId: person?.id || null, deviceId, engine, at: Date.now(), endedAt: null,
    audio: { bytes: 0, frames: 0, peak: 0, floor: null }, utterances: 0, dropped: 0, stt: { asked: 0, words: 0, empty: 0, filtered: 0, failed: 0 },
    turns: { started: 0, done: 0, cut: 0, failed: 0 }, sentences: 0, notices: 0, closed: null };
  calls.set(id, rec);
  while (calls.size > MAX_CALLS) calls.delete(calls.keys().next().value);
  push(rec, 'info', `started (${kind}${engine ? `, ${engine}` : ''})`);
  return handle(rec);
}

/** The panel's call reports by id: the same handle, or null for an id this hub never began (or has let go of). */
function get(id) { const rec = calls.get(String(id || '')); return rec ? handle(rec) : null; }

function handle(rec) {
  const h = {
    id: rec.id,
    record: rec,
    /** Audio arrived: counted, the level kept as the loudest and the room's floor. */
    audio(bytes, { level = null, floor = null } = {}) {
      if (bytes) { rec.audio.bytes += bytes; rec.audio.frames++; }   // a level the page reports is not audio received
      if (level != null && level > rec.audio.peak) rec.audio.peak = Math.round(level);
      if (floor != null) rec.audio.floor = Math.round(floor);
    },
    /** A stage, as a line: info unless said otherwise. */
    note(text, level = 'info') { return push(rec, level, text); },
    utterance({ ms, voicedMs, peak }) { rec.utterances++; push(rec, 'info', `speech found: ${ms} ms, ${voicedMs} ms of it voiced, peak ${Math.round(peak || 0)}`); },
    dropped(why) { rec.dropped++; push(rec, 'info', `sound dropped: ${why}`); },
    /** What the transcriber made of an utterance: `words` counted, `filtered` the silence phrase it was, `error` why it failed. */
    stt({ words = 0, ms = null, filtered = null, error = null } = {}) {
      rec.stt.asked++;
      const took = ms != null ? ` in ${ms} ms` : '';
      if (error) { rec.stt.failed++; return push(rec, 'error', `transcriber failed${took}: ${String(error).slice(0, 200)}`); }
      if (filtered) { rec.stt.filtered++; return push(rec, 'warn', `transcriber heard only "${String(filtered).slice(0, 60)}"${took} — a silence phrase, dropped`); }
      if (!words) { rec.stt.empty++; return push(rec, 'warn', `transcriber found no words${took}`); }
      rec.stt.words++;
      return push(rec, 'info', `transcribed ${words} word${words === 1 ? '' : 's'}${took}`);
    },
    turn(state, detail = '') {
      if (state === 'started') rec.turns.started++;
      else if (state === 'done') rec.turns.done++;
      else if (state === 'cut') rec.turns.cut++;
      else rec.turns.failed++;
      push(rec, state === 'failed' ? 'error' : state === 'cut' ? 'warn' : 'info', `turn ${state}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
    },
    spoken(n = 1) { rec.sentences += n; },
    notice(stage, text) { rec.notices++; push(rec, 'warn', `told the caller (${stage}): ${text}`); },
    end(reason) {
      if (rec.endedAt) return;
      rec.endedAt = Date.now(); rec.closed = String(reason || 'ended').slice(0, 200);
      const a = rec.audio;
      const heard = rec.kind === 'panel' ? `the microphone's peak ${a.peak}`   // the page keeps the audio; it reports levels
        : `${a.frames} audio frames, ${a.bytes} bytes, peak ${a.peak}${a.floor != null ? `, floor ${a.floor}` : ''}`;
      push(rec, 'info', `ended after ${Math.round((rec.endedAt - rec.at) / 1000)} s (${rec.closed}): ${heard}; ${rec.utterances} utterance(s), ${rec.dropped} dropped; transcribed ${rec.stt.words} of ${rec.stt.asked}`
        + ` (${rec.stt.empty} empty, ${rec.stt.filtered} screened, ${rec.stt.failed} failed); turns ${rec.turns.started} started, ${rec.turns.done} done,`
        + ` ${rec.turns.cut} cut, ${rec.turns.failed} failed; ${rec.sentences} sentence(s) spoken; ${rec.notices} notice(s)`);
    },
  };
  return h;
}

/** The kept lines a viewer may read: a host every line, anyone else their own calls'. */
function lines({ person = null, host = true } = {}) {
  return host ? ring.slice() : ring.filter(l => person?.id && l.personId === person.id);
}

/** For logs.js: the kept lines, then each new one as it comes. Returns the function that stops it. */
function open(tail, onLine) {
  for (const l of ring.slice(-tail)) onLine(l);
  if (!ring.length) onLine({ ts: new Date().toISOString(), source: 'call', label: 'Calls', level: 'info', text: 'No call since the last start. Each live call writes here, stage by stage.' });
  listeners.add(onLine);
  return () => listeners.delete(onLine);
}

const size = () => ({ lines: ring.length, bytes: ring.reduce((n, l) => n + l.text.length + 120, 0) });
const recent = () => [...calls.values()].reverse();

module.exports = { begin, get, lines, open, size, recent, _ring: ring };

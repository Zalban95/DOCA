'use strict';

/**
 * The panel's own live call (public/js/chat-call.js) reports its stages to the hub's call log (call-log.js).
 *
 * That call runs in the page: the page finds speech, records it, has it transcribed (/api/chat/transcribe), sends the
 * words as a turn (/api/chat) and speaks the answer (/api/chat/synthesize). Until 2026-10-08 none of it left a trace on
 * the hub but a turn — and a turn the page hung up on 689 ms in left only "This operation was aborted", with nothing
 * saying whether the person ended the call, the page went away or the call's own logic cut it. Now the page opens a
 * record when the call starts and says what it did (`POST /api/chat/call-event`), and the transcription and the turn
 * name the call they belong to (the field `call`), so the hub writes down what the transcriber made of each recording
 * and how each turn ended — from its own side, where a page that went away cannot leave it out.
 *
 * Events are names and numbers (STAGES): no words, and only to a call this person began.
 */
const callLog = require('./call-log');

const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const word = v => String(v || '').replace(/[^\w .,:;'’()—–→-]/g, '').slice(0, 160);

/** What the page may report, and what each becomes in the log. */
const STAGES = {
  start:    (_l, b) => `the page opened the microphone${b.ambient ? ' (Ambient’s assistant)' : b.assistant ? ' (the Live call)' : ''}${b.mobile ? ' on a phone' : ''}; speech over ${num(b.threshold)} counts`,
  level:    (l, b) => { l.audio(0, { level: num(b.peak) }); return `the microphone's loudest in the last ${num(b.seconds) || 10} s: ${num(b.peak)} (speech counts over ${num(b.threshold)})`; },
  speech:   (_l, b) => `speech started (level ${num(b.level)})`,
  sent:     (l, b) => { l.utterance({ ms: num(b.ms) || 0, voicedMs: num(b.voicedMs) || 0, peak: num(b.peak) || 0 }); return null; },
  dropped:  (l, b) => { l.dropped(word(b.why) || 'too short'); return null; },
  hold:     (_l, b) => `sound over the answer for ${num(b.ms)} ms: the voice paused to hear it`,
  resumed:  (_l, b) => `the voice went on (${word(b.why) || 'no words in it'})`,
  cut:      (_l, b) => `the answer was cut: ${word(b.why)}`,
  paused:   (_l, b) => `the call gave the microphone up for now: ${word(b.why)}`,   // a phone call (chat-call-pause.js)
  played:   (l, b) => { l.spoken(num(b.n) || 1); return b.audio && b.audio !== 'running' ? `a sentence began while the page's audio was ${word(b.audio)} — it may not have been heard` : null; },
  notice:   (l, b) => { l.notice(word(b.where) || 'call', word(b.text)); return null; },
  error:    (_l, b) => `the page: ${word(b.text)}`,
  ask:      (_l, b) => `asked in the call: may ${word(b.tool)} run? — said aloud, waiting for a yes or a no`,   // chat-call-ask.js
  answered: (_l, b) => `answered by voice: ${b.decision === 'once' ? 'allowed once' : 'denied'} (${word(b.tool)})`,
};

/** The record of a call this person began, or null. */
function own(req, id) {
  const h = callLog.get(id);
  const me = req.auth?.user?.id || null;
  return h && (!h.record.personId || h.record.personId === me) ? h : null;
}

/** POST /api/chat/call-event {stage, call?, …} — `start` answers with the call's id; `end` closes it. */
function handleEvent(req, res) {
  const b = req.body || {};
  const stage = String(b.stage || '');
  if (stage === 'start') {
    const label = b.ambient ? 'the panel — Ambient’s assistant' : b.assistant ? 'the panel — Live call' : 'the panel — Deep call';
    const person = req.auth?.user ? { id: req.auth.user.id } : null;
    let sessionId = null;
    try { sessionId = require('../harness/memory').mainSession().id; } catch { /* named later by its turns */ }
    const h = callLog.begin({ kind: 'panel', label: `${label}${b.mobile ? ' (phone)' : ''}`, sessionId, person, engine: 'panel' });
    // A call that could not start is a call attempt too, and the commonest failure (deep test A, #9): kept and closed.
    if (b.refused) { h.note(`the call did not start: ${word(b.refused)}`, 'warn'); h.end('did not start'); return res.json({ call: h.id }); }
    h.note(STAGES.start(h, b));
    return res.json({ call: h.id });
  }
  const h = own(req, b.call);
  if (!h) return res.status(404).json({ error: 'No such call.' });
  if (stage === 'end') { h.end(word(b.why) || 'ended'); return res.json({ ok: true }); }
  const fn = STAGES[stage];
  if (!fn) return res.status(400).json({ error: `Not a call stage: ${stage.slice(0, 40)}` });
  const text = fn(h, b);
  if (text) h.note(text, ['cut', 'error', 'played'].includes(stage) ? 'warn' : 'info');
  res.json({ ok: true });
}

/** A transcription for a call: what came of it, from the hub's side. */
function heard(req, { text = '', filtered = null, error = null, ms = null, language = null, heardAs = null } = {}) {
  const h = own(req, req.body?.call);
  if (!h) return;
  const t = String(text || '').trim();
  h.stt({ words: t ? t.split(/\s+/).length : 0, filtered, error, ms, language, heardAs });
}

/**
 * A turn for a call (/api/chat with `call`): started now; how it ended is said when the response ends — done, or cut
 * because the page hung up on it (and how long after it started), which is the evidence the 2026-10-08 call lacked.
 */
function turn(req, res) {
  const h = own(req, req.body?.call);
  if (!h) return () => {};
  const t0 = Date.now();
  let settled = false;
  h.turn('started', `${String(req.body?.message || '').split(/\s+/).filter(Boolean).length} words asked`);
  res.on('close', () => { if (!settled) { settled = true; h.turn('cut', `the page closed the answer's stream ${Date.now() - t0} ms after it started`); } });
  return (ok, why = '') => { if (settled) return; settled = true; h.turn(ok ? 'done' : 'failed', why || `after ${Date.now() - t0} ms`); };
}

module.exports = { handleEvent, heard, turn, STAGES };

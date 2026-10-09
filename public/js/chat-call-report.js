/* The live call says what each of its stages did (asked 2026-10-08: "it fails silently"). The page opens a record on
   the hub when the call starts (POST /api/chat/call-event, modules/realtime/panel-call.js) and reports to it — speech
   found, a recording sent or dropped, the voice paused or cut, notices — in names and numbers; the transcription and
   the turn carry the call's id, so the hub writes down their outcome from its own side (Hub → Logs, source `call`).
   A stage that fails is also said here, in the chat and on the call's status line: never a quiet call. */
let _callLogId = null;
let _callLevelPeak = 0, _callLevelAt = 0;

/** Open the call's record on the hub (best effort: a call goes on without one). */
async function _callReportStart(assistant) {
  _callLogId = null; _callLevelPeak = 0; _callLevelAt = performance.now();
  try {
    const mobile = matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|DocaMobile/.test(navigator.userAgent);
    _callLogId = (await apiFetch('/api/chat/call-event', { method: 'POST', body: { stage: 'start', assistant: !!assistant, ambient: !!assistant && typeof ambientIsOpen === 'function' && ambientIsOpen(), mobile, threshold: _callThreshold } })).call || null;
  } catch { /* no record: the call still works */ }
}

/** A stage, sent and not waited for. */
function _callReport(stage, fields = {}) {
  if (!_callLogId) return;
  apiFetch('/api/chat/call-event', { method: 'POST', body: { ...fields, stage, call: _callLogId } }).catch(() => {});
}

/** The microphone's loudest level, reported every ten seconds while the call listens: a quiet microphone shows here. */
function _callReportLevel(energy) {
  if (energy > _callLevelPeak) _callLevelPeak = energy;
  const now = performance.now();
  if (now - _callLevelAt < 10000) return;
  _callReport('level', { peak: _callLevelPeak, threshold: _callThreshold, seconds: Math.round((now - _callLevelAt) / 1000) });
  _callLevelPeak = 0; _callLevelAt = now;
}

/** Something did not go as it should: said in the chat and on the status line, and kept on the hub. The status line keeps
 *  it a few seconds, so the "Listening…" that follows at once does not wipe it before it is read. `quiet`: shown only
 *  (the answer's own text, which the hub does not keep). */
let _callNoticeUntil = 0;
function _callNotice(stage, text, { quiet = false } = {}) {
  if (!quiet) chatAppendMsg('system', text);
  _callSetStatus(text, 'listening');
  _callNoticeUntil = performance.now() + 8000;
  if (!quiet) _callReport('notice', { where: stage, text });
}

/** The call ends: the record says why. */
function _callReportEnd(why) {
  _callReport('end', { why });
  _callLogId = null;
}

/** Why the last call did not start ('' when it did): face/assistant.js and ambient.js say it on their own screen. */
let _callNotStarted = '';

/**
 * The call could not start (deep test A, #9): no speech service, no microphone. It used to be said only in the chat —
 * closed behind the face and Ambient, so those showed nothing — and to leave no record, because the refusal came
 * before the call's record was opened. Now it is said in the chat, on the call's status line, on the face and on
 * Ambient's line, and the hub's call log keeps it as a call that did not start.
 */
function _callRefuse(why, assistant) {
  _callNotStarted = why;
  chatAppendMsg('system', why);
  const st = document.getElementById('chat-call-status');
  if (st) st.textContent = why;
  if (typeof assistantIsOpen === 'function' && assistantIsOpen() && typeof _assistantSay === 'function') _assistantSay(why);
  if (typeof ambientIsOpen === 'function' && ambientIsOpen() && typeof ambientSay === 'function') ambientSay(why);
  const mobile = !!globalThis.matchMedia?.('(pointer: coarse)').matches || /Android|iPhone|DocaMobile/.test(navigator.userAgent);
  apiFetch('/api/chat/call-event', { method: 'POST', body: { stage: 'start', refused: why, assistant: !!assistant, mobile,
    ambient: !!assistant && typeof ambientIsOpen === 'function' && ambientIsOpen() } }).catch(() => {});
}

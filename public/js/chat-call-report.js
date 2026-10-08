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
    _callLogId = (await apiFetch('/api/chat/call-event', { method: 'POST', body: { stage: 'start', assistant: !!assistant, mobile, threshold: _callThreshold } })).call || null;
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

/** Something did not go as it should: said in the chat and on the status line, and kept on the hub. */
function _callNotice(stage, text) {
  chatAppendMsg('system', text);
  _callSetStatus(text, 'listening');
  _callReport('notice', { where: stage, text });
}

/** The call ends: the record says why. */
function _callReportEnd(why) {
  _callReport('end', { why });
  _callLogId = null;
}

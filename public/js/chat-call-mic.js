/* The live call's microphone, watched (asked 2026-10-08: a call opened six seconds after another heard a level of 0
   for 54 s on a phone, and said nothing). A microphone in a room is never pure digital silence: its samples carry
   the room's noise even under noise suppression. So the first seconds of a call are watched — and when the samples
   are exactly zero, or the track is muted or ended, or the call's audio is held suspended, the call does what can be
   done once (wakes its audio, opens the microphone again) and then says what it found, on the hub's call log too.
   Out of chat-call.js along its seam: the call itself stays there. */

const CALL_DEAD_MIC_MS = 4000;   // pure silence this long from the start: the microphone gives nothing
let _callMicWatch = null;        // {at, reopened, busy} while the call has not yet heard anything
let _callMicSample = null;       // a scratch buffer for the analyser's samples

/** The call began listening: watch until the microphone gives anything at all. */
function _callMicWatchStart() {
  _callMicWatch = { at: performance.now(), reopened: false, busy: false };
}

function _callMicWatchStop() { _callMicWatch = null; }

/** What is wrong with the call's microphone right now, in words — or '' when it gives sound. */
function _callMicTrouble() {
  const track = _callStream?.getAudioTracks?.()[0];
  if (!track || track.readyState === 'ended') return 'its track ended';
  if (track.muted) return 'the system muted it (another app or a call may hold it)';
  if (_callAudioCtx?.state === 'suspended') return 'the page’s audio is waiting for a touch';
  if (!_callAnalyser?.getFloatTimeDomainData) return '';
  if (!_callMicSample || _callMicSample.length !== _callAnalyser.fftSize) _callMicSample = new Float32Array(_callAnalyser.fftSize);
  _callAnalyser.getFloatTimeDomainData(_callMicSample);
  for (let i = 0; i < _callMicSample.length; i++) if (_callMicSample[i] !== 0) return '';
  return 'it gives pure silence';
}

/** Once a frame from the call's loop, until something is heard. */
function _callMicWatchFrame() {
  const w = _callMicWatch;
  if (!w || w.busy || !_callActive) return;
  const trouble = _callMicTrouble();
  if (!trouble) { _callMicWatchStop(); return; }   // it hears the room: nothing to watch
  if (performance.now() - w.at < CALL_DEAD_MIC_MS) return;
  if (!w.reopened) { w.reopened = true; w.busy = true; _callMicReopen(trouble).finally(() => { w.busy = false; w.at = performance.now(); }); return; }
  _callMicWatchStop();
  _callNotice('mic', `The microphone gives nothing — another app or a call may hold it (${trouble}). Close the other one, or end this call and start it again.`);
}

/** Wake the call's audio and open the microphone again, once. */
async function _callMicReopen(trouble) {
  _callReport('notice', { where: 'mic', text: `nothing from the microphone for ${CALL_DEAD_MIC_MS / 1000} s (${trouble}): opening it again` });
  _callAudioCtx?.resume?.().catch(() => {});
  let fresh;
  try { if (typeof micDrop === 'function') micDrop(); fresh = await micOpen(MIC_SPEECH); }
  catch (e) { _callReport('notice', { where: 'mic', text: `it did not open again: ${e.message}` }); return; }
  if (!_callActive || !_callAudioCtx) { fresh.getTracks().forEach(t => t.stop()); return; }
  const old = _callStream;
  _callStream = fresh;
  old?.getTracks().forEach(t => t.stop());
  _callTapStop();
  const source = _callAudioCtx.createMediaStreamSource(fresh);
  source.connect(_callAnalyser);
  _callTapStart(source);
}

// The page's audio may be held until a touch: a call started from a hold that has not ended yet, or by the wake word,
// has no gesture of its own. While a call is on (chat-call.js adds and removes this), any touch or key wakes both of its
// audio contexts.
const CALL_TOUCH = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
const _callMicTouch = () => { _callAudioCtx?.resume?.().catch(() => {}); if (!_callHold) _callPlayCtx?.resume?.().catch(() => {}); };
function _callMicTouchWake(on) {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  for (const e of CALL_TOUCH) (on ? document.addEventListener : document.removeEventListener).call(document, e, _callMicTouch, { passive: true });
}

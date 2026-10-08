/* Opening the microphone, and saying why it did not open (the voice note, the live call, its test meter). A phone's app
   reported only "No microphone": the reason is one of a few, and each has a different fix, so the message names it. */

/** How a call and the wake word both open it: the same constraints, so one can take the other's stream over. */
const MIC_SPEECH = { echoCancellation: true, noiseSuppression: true };

// The hand-off (2026-10-08: a call opened six seconds after another heard pure silence for 54 s on a phone). Stopping a
// stream and asking for a new one at once is a race on Android — the capture the system is still closing can leave the
// new one silent. So whoever lets go of the microphone hands its stream over for a moment (`micHandOff`), and the next
// `micOpen` with the same constraints takes it as it is, live; nobody taking it in that moment stops it.
const MIC_HANDOFF_MS = 1500;
let _micKept = null;   // {stream, key, timer}

/** Whether a stream still gives sound: a live, unmuted audio track. */
function micLive(stream) {
  return !!stream?.getAudioTracks?.().some(t => t.readyState === 'live' && !t.muted && t.enabled !== false);
}

/** Let go of the microphone, leaving `stream` for whoever opens it next with the same constraints (briefly). */
function micHandOff(stream, audio = MIC_SPEECH) {
  micDrop();
  if (!stream) return;
  if (!micLive(stream)) { stream.getTracks().forEach(t => t.stop()); return; }
  _micKept = { stream, key: JSON.stringify(audio), timer: setTimeout(micDrop, MIC_HANDOFF_MS) };
}

/** Nobody took it: the microphone is given up. */
function micDrop() {
  const k = _micKept;
  _micKept = null;
  if (!k) return;
  clearTimeout(k.timer);
  k.stream.getTracks().forEach(t => t.stop());
}

/** getUserMedia for audio, or an Error whose message says what to do. */
async function micOpen(audio = true) {
  if (_micKept && _micKept.key === JSON.stringify(audio)) {   // handed over a moment ago: taken as it is
    const { stream } = _micKept;
    clearTimeout(_micKept.timer); _micKept = null;
    if (micLive(stream)) return stream;
    stream.getTracks().forEach(t => t.stop());
  }
  micDrop();   // another kind of opening: what was kept is let go first
  const app = /DocaMobile|; wv\)/.test(navigator.userAgent);   // the Android app's web view
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new Error(`this page is not a secure context (${location.protocol}//${location.host}), and browsers give the microphone only to those. `
      + 'Open the panel over https — the tailnet name with a real certificate (tailscale cert) is trusted everywhere.');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (e) {
    const how = {
      NotAllowedError: app
        ? 'the app was refused it. On the phone: Settings → Apps → DOCA → Permissions → Microphone → Allow, then try again.'
        : 'the browser was refused it. Allow the microphone for this site (the icon beside the address), then try again.',
      SecurityError: 'the browser blocks the microphone on this page (an insecure or untrusted connection).',
      NotFoundError: 'there is no microphone on this device, or it is switched off.',
      NotReadableError: app
        ? 'the app could not open the microphone. Update the DOCA app: versions before 1.0.1 lack an Android permission (MODIFY_AUDIO_SETTINGS) its web view needs.'
        : 'another app is using the microphone. Close it (a call, a recorder) and try again.',
      AbortError: 'the system stopped it before it opened. Try again.',
      OverconstrainedError: 'this microphone cannot record the way the call asks.',
    }[e.name];
    throw new Error(how ? `${how} (${e.name})` : `${e.name || 'Error'}: ${e.message}`);
  }
}

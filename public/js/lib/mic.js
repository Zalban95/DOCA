/* Opening the microphone, and saying why it did not open (the voice note, the live call, its test meter). A phone's app
   reported only "No microphone": the reason is one of a few, and each has a different fix, so the message names it. */

/** getUserMedia for audio, or an Error whose message says what to do. */
async function micOpen(audio = true) {
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
      NotReadableError: 'another app is using the microphone. Close it (a call, a recorder) and try again.',
      AbortError: 'the system stopped it before it opened. Try again.',
      OverconstrainedError: 'this microphone cannot record the way the call asks.',
    }[e.name];
    throw new Error(how ? `${how} (${e.name})` : `${e.name || 'Error'}: ${e.message}`);
  }
}

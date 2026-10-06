/* Calling the hive by name (experiments.wakeWord; docs/experiments/wake-word.md, TODO H8.2). While the corner face
   shows on a screen that asked for it (call.listenWithFace) and no call is on, the page listens: each short burst of
   speech goes to this hive's own speech-to-text with the wake word as its spelling hint, and a transcript that begins
   by calling it (lib/wake-match.js) starts a live call — what was said after the name is the call's first message.
   Everything said near the screen while it listens reaches the speech service; nothing is kept and nothing else is sent. */

const WAKE_SILENCE_MS = 700, WAKE_MAX_MS = 5000, WAKE_MIN_VOICED_MS = 300;
let _wake = null;           // {stream, ctx, an, raf, word, thr, rec, voiced, quietAt, startedAt, busy}
let _wakeApplying = false;

/** Listen when this screen wants it, stop when it does not: called at load, on the face's switch, after a call. */
async function wakeWordApply() {
  if (_wakeApplying) return;
  _wakeApplying = true;
  try {
    const want = await _wakeWanted();
    if (!want) return wakeWordPause();
    if (_wake) { Object.assign(_wake, want); return; }
    let stream;
    try { stream = await micOpen({ echoCancellation: true, noiseSuppression: true }); }
    catch (e) { console.warn('wake word: the microphone did not open —', e.message); return; }
    if (!(await _wakeWanted())) { stream.getTracks().forEach(t => t.stop()); return; }   // a call began meanwhile
    const ctx = new AudioContext(), an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    // A page that nobody has touched yet gets a suspended context; the first touch anywhere wakes it.
    if (ctx.state === 'suspended') document.addEventListener('pointerdown', () => ctx.resume().catch(() => {}), { once: true });
    _wake = { stream, ctx, an, ...want, rec: null, voiced: 0, quietAt: 0, startedAt: 0, last: 0, busy: false };
    _wakeLoop();
  } finally { _wakeApplying = false; }
}

/** Stop listening (a call took the microphone, the face went away, the page was hidden). */
function wakeWordPause() {
  if (!_wake) return;
  cancelAnimationFrame(_wake.raf);
  if (_wake.rec && _wake.rec.state !== 'inactive') { _wake.rec.onstop = null; _wake.rec.stop(); }
  _wake.stream.getTracks().forEach(t => t.stop());
  _wake.ctx.close().catch(() => {});
  _wake = null;
}

async function _wakeWanted() {
  // Only while assistant mode is open (resting, waiting for its name): the panel itself never holds the microphone
  // — it is used in a call, a recording, or here (asked 2026-10-06: "the microphone is always in use").
  const faceShown = typeof assistantIsOpen === 'function' && assistantIsOpen();
  if (!faceShown || document.hidden) return null;
  if ((typeof _callActive !== 'undefined' && _callActive) || (typeof _rt !== 'undefined' && _rt)) return null;
  const s = await screenLoad();
  const c = s.settings?.call || {};
  if (!s.experiments?.wakeWord || !c.listenWithFace) return null;
  let word = String(c.wakeWord || '').trim();
  if (!word) word = (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA';
  return { word, thr: c.sensitivity >= 1 ? c.sensitivity : 15 };
}

function _wakeLoop() {
  const w = _wake;
  if (!w) return;
  const data = new Uint8Array(w.an.frequencyBinCount);
  w.an.getByteFrequencyData(data);
  const energy = data.reduce((a, b) => a + b, 0) / data.length;
  const now = performance.now(), dt = w.last ? Math.min(100, now - w.last) : 0;
  w.last = now;
  if (energy > w.thr && !w.busy) {
    if (!w.rec) _wakeRecord(w, now);
    w.voiced += dt;
    w.quietAt = 0;
    if (typeof faceCornerVoice === 'function') faceCornerVoice('listening', energy / 80);
  } else if (w.rec && !w.quietAt) w.quietAt = now;
  if (w.rec && ((w.quietAt && now - w.quietAt > WAKE_SILENCE_MS) || now - w.startedAt > WAKE_MAX_MS)) w.rec.stop();
  w.raf = requestAnimationFrame(_wakeLoop);
}

function _wakeRecord(w, now) {
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(w.stream, { mimeType }), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const voiced = w.voiced;
    w.rec = null; w.voiced = 0; w.quietAt = 0;
    if (voiced >= WAKE_MIN_VOICED_MS && chunks.length && _wake === w) _wakeHear(w, new Blob(chunks, { type: mimeType }));
  };
  w.rec = rec; w.startedAt = now; w.voiced = 0;
  rec.start();
}

async function _wakeHear(w, blob) {
  w.busy = true;
  try {
    const form = new FormData();
    form.append('audio', blob, 'wake.webm');
    form.append('prompt', w.word);   // the spelling hint: Whisper has never heard an invented name
    const r = await fetch('/api/chat/transcribe', { method: 'POST', body: form });
    const { text } = await r.json();
    const m = wakeMatch(text, w.word);
    if (!m.heard || _wake !== w) return;
    wakeWordPause();
    await assistantOpen(m.rest);   // the name opens assistant mode: the face, talking (face/assistant.js)
    if (!_assistantInCall()) wakeWordApply();
  } catch (e) { console.warn('wake word:', e.message); }
  finally { w.busy = false; }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(wakeWordApply, 1500));   // after the face is drawn
  document.addEventListener('visibilitychange', wakeWordApply);
}

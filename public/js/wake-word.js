/* Calling the hive by name (experiments.wakeWord; docs/experiments/wake-word.md, TODO H8.2). While the corner face
   shows on a screen that asked for it (call.listenWithFace) and no call is on, the page listens: each short burst of
   speech goes to this hive's own speech-to-text with the wake word as its spelling hint, and a transcript that begins
   by calling it (lib/wake-match.js) starts a live call — what was said after the name is the call's first message.
   Everything said near the screen while it listens reaches the speech service; nothing is kept and nothing else is sent. */

const WAKE_SILENCE_MS = 700, WAKE_MAX_MS = 5000, WAKE_MIN_VOICED_MS = 300;
let _wake = null;           // {stream, ctx, an, raf, word, thr, rec, voiced, quietAt, startedAt, busy}
let _wakeApplying = false, _wakeAgain = false;
const WAKE_TOUCH = ['pointerdown', 'keydown', 'touchend'];

/** Listen when this screen wants it, stop when it does not: called at load, on the face's switch, after a call. */
async function wakeWordApply() {
  if (_wakeApplying) { _wakeAgain = true; return; }   // asked again while deciding: decided again after, never dropped
  _wakeApplying = true;
  try {
    const want = await _wakeWanted();
    if (!want) return wakeWordPause();
    if (_wake) { Object.assign(_wake, want); return; }
    let stream;
    try { stream = await micOpen(MIC_SPEECH); }   // a call's stream, handed over as it ended (lib/mic.js)
    catch (e) { console.warn('wake word: the microphone did not open —', e.message); return; }
    if (!(await _wakeWanted())) { micHandOff(stream); return; }   // a call began meanwhile: it may take this stream
    const ctx = new AudioContext(), an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    // A page that nobody has touched yet gets a suspended context, which hears nothing: every touch or key wakes it, and
    // an ambient screen says it needs one (wakeWordState).
    const wakeCtx = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
    WAKE_TOUCH.forEach(e => document.addEventListener(e, wakeCtx, { passive: true }));
    ctx.onstatechange = () => { if (typeof ambientHearing === 'function') ambientHearing({ suspended: ctx.state === 'suspended' }); };
    ctx.onstatechange();
    _wake = { stream, ctx, an, wakeCtx, ...want, model: null, rec: null, voiced: 0, quietAt: 0, startedAt: 0, last: 0, busy: false };
    if (typeof ambientHearing === 'function') ambientHearing({ listening: true, word: want.word });
    // A model trained for the word (experiments.wakeModel, lib/wake-model.js): heard on the screen, nothing sent. Without
    // one, or if it cannot run here, the transcript match below as before.
    const url = want.useModel && typeof wakeModelFor === 'function' ? await wakeModelFor(want.word) : '';
    if (url) {
      const w = _wake;
      try { const m = await wakeModelStart(stream, url, { onWake: () => _wakeModelHeard(w) }); if (_wake === w) w.model = m; else m?.stop?.(); return; }
      catch (e) { console.warn('wake model: falling back to speech-to-text —', e.message); }
    }
    _wakeLoop();
  } finally {
    _wakeApplying = false;
    if (_wakeAgain) { _wakeAgain = false; wakeWordApply(); }
  }
}

/**
 * Stop listening (a call took the microphone, the face went away, the page was hidden). It never throws: until
 * 2026-10-08 a resting screen without a trained model kept `model: false` here, `false?.stop()` threw, and every call
 * from then on died before it opened the microphone — Ambient's galaxy rose and fell, and nothing reached the hub.
 * The stream is handed over (lib/mic.js), so a call opening now takes it live instead of reopening the microphone.
 */
function wakeWordPause() {
  const w = _wake;
  if (!w) return;
  _wake = null;
  const quietly = fn => { try { fn(); } catch (e) { console.warn('wake word: letting go —', e.message); } };
  quietly(() => { if (typeof w.model?.stop === 'function') w.model.stop(); });
  quietly(() => { if (typeof ambientHearing === 'function') ambientHearing({ listening: false }); });
  quietly(() => cancelAnimationFrame(w.raf));
  quietly(() => { if (w.rec && w.rec.state !== 'inactive') { w.rec.onstop = null; w.rec.stop(); } });
  quietly(() => micHandOff(w.stream));
  quietly(() => WAKE_TOUCH.forEach(e => document.removeEventListener(e, w.wakeCtx)));
  quietly(() => w.ctx.close().catch(() => {}));
}

async function _wakeWanted() {
  // Only while assistant mode is open (resting, waiting for its name): the panel itself never holds the microphone
  // — it is used in a call, a recording, or here (asked 2026-10-06: "the microphone is always in use").
  const faceShown = typeof assistantIsOpen === 'function' && assistantIsOpen();
  const ambient = typeof ambientIsOpen === 'function' && ambientIsOpen();   // an ambient screen resting (ambient.js)
  if (!(faceShown || ambient) || document.hidden) return null;
  if ((typeof _callActive !== 'undefined' && _callActive) || (typeof _rt !== 'undefined' && _rt)) return null;
  if (typeof _callStarting !== 'undefined' && _callStarting) return null;   // a call is opening the microphone: leave it alone
  const s = await screenLoad();
  const c = s.settings?.call || {};
  if (!s.experiments?.wakeWord || !(ambient ? s.settings?.ambient?.listen !== false : c.listenWithFace)) return null;
  let word = String(c.wakeWord || '').trim();
  if (!word) word = (typeof BRAND !== 'undefined' && BRAND?.product) || 'DOCA';
  return { word, thr: c.sensitivity >= 1 ? c.sensitivity : 15, useModel: !!s.experiments?.wakeModel };   // not `model`: that is the running model, and a re-apply merges this in
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

/** The model heard the word: the call opens, as a matched transcript opens it (with no words after the name to pass). */
async function _wakeModelHeard(w) {
  if (_wake !== w) return;
  if (typeof ambientHearing === 'function') ambientHearing({ heard: w.word, called: true, word: w.word });
  wakeWordPause();
  if (typeof ambientIsOpen === 'function' && ambientIsOpen()) await ambientTalk();
  else await assistantOpen();
  if (!_assistantInCall()) wakeWordApply();
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
    if (typeof ambientHearing === 'function') ambientHearing({ heard: text, called: m.heard, word: w.word });   // what it understood, on screen
    if (!m.heard || _wake !== w) return;
    wakeWordPause();
    if (typeof ambientIsOpen === 'function' && ambientIsOpen()) await ambientTalk(m.rest);   // the galaxy rises and listens
    else await assistantOpen(m.rest);   // the name opens assistant mode: the face, talking (face/assistant.js)
    if (!_assistantInCall()) wakeWordApply();
  } catch (e) { console.warn('wake word:', e.message); }
  finally { w.busy = false; }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(wakeWordApply, 1500));   // after the face is drawn
  document.addEventListener('visibilitychange', wakeWordApply);
}

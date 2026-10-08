/* Whether this screen's microphone may stay open in the background (asked 2026-10-08: "when the app is in background I
   can use the microphone for other apps if I want to"). The screen-home setting `call.micAlways`, off by default, and
   the switch beside the chats (mic-keep-ui.js):
   - off: the microphone is open only for a call or a recording, and a page that goes to the background lets go of it
     at once — the call ends, a voice note is sent as it stands, the wake word stops until the page shows again;
   - on: it may stay open in the background, so the wake word keeps listening and a call keeps going.
   In DocaMobile the app holds it (`window.DocaDevice.micAlways`: a foreground service of type microphone with its own
   notification) and tells the page about phone calls, which pause a call and give the microphone up — event `doca-mic`.
   In a plain browser, whether a page in the background keeps the microphone is the browser's decision. */

let _micKeep = { on: false, loaded: false, paused: '', app: null };   // app: the DocaMobile side's last word, or null

/** DocaMobile's microphone bridge, when this page is inside the app (≥ 1.3.0) and the app holds a switch for it
 *  (the screen saver's web view has the bridge and no switch: it answers "null"). */
function micKeepBridge() {
  const d = typeof window !== 'undefined' ? window.DocaDevice : null;
  if (!d || typeof d.micAlways !== 'function') return null;
  if (_micKeep.inApp === undefined) { try { _micKeep.inApp = d.micState() !== 'null'; } catch { _micKeep.inApp = false; } }
  return _micKeep.inApp ? d : null;
}

/** Whether the microphone may stay open in the background on this screen (sync; the setting as last read). */
function micAlwaysOn() { return _micKeep.on; }

/** Why the microphone is given up for now ('phone-call', 'another-app'), or ''. */
function micKeepPaused() { return _micKeep.paused; }

async function micKeepLoad() {
  try { _micKeep.on = !!(await screenLoad()).settings?.call?.micAlways; } catch { /* off */ }
  _micKeep.loaded = true;
  _micKeepApp(b => b.micAlways(_micKeep.on));   // the app follows the screen's setting (its service starts while we show)
  if (typeof micKeepRefresh === 'function') micKeepRefresh();
}

/** The switch: saved as this screen's, then the app told. */
async function micKeepSet(on) {
  on = !!on;
  const cur = (await screenLoad(true)).settings?.call || {};
  await screenSave({ call: { ...cur, micAlways: on } });
  _micKeep.on = on;
  _micKeepApp(b => b.micAlways(on));
  if (typeof micKeepRefresh === 'function') micKeepRefresh();
  if (typeof wakeWordApply === 'function') wakeWordApply();
}

/** Ask the app, keeping its answer (`{on, service, paused, why}`) for the switch's words. */
function _micKeepApp(call) {
  const b = micKeepBridge();
  if (!b) return;
  try { const r = JSON.parse(call(b) || 'null'); if (r) { _micKeep.app = r; if (typeof r.paused === 'string') _micKeep.paused = r.paused; } }
  catch (e) { console.warn('mic: the app did not answer —', e.message); }
}

/** What holds the microphone on this page now: 'call', 'paused', 'recording', 'listening' (the wake word), or ''. */
function micHeldNow() {
  if (typeof _callActive !== 'undefined' && _callActive) return _callStream ? 'call' : 'paused';
  if (typeof _rt !== 'undefined' && _rt) return 'call';
  if (typeof _chatRec !== 'undefined' && _chatRec) return 'recording';
  if (typeof _wake !== 'undefined' && _wake) return 'listening';
  return '';
}

/** The decision, without side effects: what to do with the microphone given where the page is. */
function micKeepPlan({ hidden, on, paused, held }) {
  if (paused && held && held !== 'paused') return 'pause';
  if (hidden && !on && held) return 'release';
  if (!paused && held === 'paused' && (on || !hidden)) return 'resume';
  return 'none';
}

const MIC_PAUSE_WORDS = { 'phone-call': 'Paused for a phone call', 'another-app': 'Paused — another app is using the microphone' };

/** Act on the plan: called when the page's visibility changes and when the app reports a phone call. */
async function micKeepCheck() {
  const held = micHeldNow();
  const plan = micKeepPlan({ hidden: typeof document !== 'undefined' && document.hidden, on: _micKeep.on, paused: _micKeep.paused, held });
  if (plan === 'release') micKeepRelease('the page went to the background');
  // Hidden with the switch off: nothing is kept for a next call either — a stream handed over a moment ago (lib/mic.js
  // micHandOff, by whatever let go first) is stopped now, not 1.5 s later.
  else if (plan === 'none' && typeof document !== 'undefined' && document.hidden && !_micKeep.on) _micKeepDrop();
  else if (plan === 'pause') _micKeepPause(MIC_PAUSE_WORDS[_micKeep.paused] || 'Paused');
  else if (plan === 'resume' && typeof _callResume === 'function') await _callResume();
  if (typeof wakeWordApply === 'function') wakeWordApply();
  if (typeof micKeepRefresh === 'function') micKeepRefresh();
}

/** The hand-off between calls keeps a released stream live for a moment; a release for the background or a phone call
 *  must not, so whatever was handed over is stopped at once. */
function _micKeepDrop() { if (typeof micDrop === 'function') micDrop(); }

/** Give the microphone up: the call ends, a voice note is sent as it stands, the wake word stops — and nothing is kept. */
function micKeepRelease(why) {
  if (typeof _callActive !== 'undefined' && _callActive) {
    _callStop(why);
    if (typeof chatAppendMsg === 'function') chatAppendMsg('system', 'The call ended when the page went to the background: the microphone stays open there only with "Mic: on" beside the chat.');
  }
  if (typeof _rt !== 'undefined' && _rt && typeof realtimeStop === 'function') realtimeStop();
  if (typeof _chatRec !== 'undefined' && _chatRec && typeof _chatVoiceStop === 'function') _chatVoiceStop();
  if (typeof wakeWordPause === 'function') wakeWordPause();
  _micKeepDrop();
}

/** A phone call (or another app recording): a call pauses and gives the microphone up; the rest stops. */
function _micKeepPause(words) {
  if (typeof _callActive !== 'undefined' && _callActive && typeof _callPause === 'function') _callPause(words);
  if (typeof _rt !== 'undefined' && _rt && typeof realtimeStop === 'function') {
    realtimeStop();
    if (typeof chatAppendMsg === 'function') chatAppendMsg('system', `${words}: the realtime call ended.`);
  }
  if (typeof _chatRec !== 'undefined' && _chatRec && typeof _chatVoiceStop === 'function') _chatVoiceStop();
  if (typeof wakeWordPause === 'function') wakeWordPause();
  _micKeepDrop();   // the phone call has to have it now, not after the hand-off's moment
}

/** What the app says (DocaMobile's `doca-mic` event): {paused, background, on, service, why}. */
function micKeepFromApp(d = {}) {
  _micKeep.app = { ..._micKeep.app, ...d };
  if (typeof d.paused === 'string') _micKeep.paused = d.paused;
  // "Stop listening" on the app's notice: the switch goes off here too, saved as this screen's.
  if (d.on === false && _micKeep.on) micKeepSet(false).catch(e => console.warn('mic: the switch was not saved —', e.message));
  if (d.background && !_micKeep.on) return micKeepRelease('the app went to the background');
  return micKeepCheck();
}

/* A loop that reads the microphone keeps running in the background: a hidden page gets no animation frames, and its
   timers are slowed to one a second, so a hidden page ticks from a small worker (which the browser does not slow). */
let _micTicker = null;
const _micTicks = new Map();
let _micTickId = 0;

/** requestAnimationFrame while the page shows, a 50 ms tick while it is hidden. Returns a handle for micFrameCancel. */
function micFrame(fn) {
  if (!document.hidden || typeof Worker === 'undefined') return requestAnimationFrame(fn);
  if (!_micTicker) {
    try {
      const src = 'setInterval(() => postMessage(0), 50)';
      _micTicker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      _micTicker.onmessage = () => { const due = [..._micTicks.values()]; _micTicks.clear(); due.forEach(f => f(performance.now())); };
    } catch { _micTicker = null; return { t: setTimeout(fn, 50) }; }
  }
  const id = ++_micTickId;
  _micTicks.set(id, fn);
  return { tick: id };
}

function micFrameCancel(h) {
  if (h && typeof h === 'object') { if (h.tick) _micTicks.delete(h.tick); if (h.t) clearTimeout(h.t); }
  else if (h) cancelAnimationFrame(h);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(micKeepLoad, 500));
  document.addEventListener('visibilitychange', micKeepCheck);
  window.addEventListener('doca-mic', e => micKeepFromApp(e.detail || {}));
}

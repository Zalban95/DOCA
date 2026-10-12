/* The voice, in the Focused view: the face's own points (face/face.js), placed bigger or smaller — never a new shape,
   motion or colour. Every mounted copy hears the hive's state from one feed (faceFeed), and while a call speaks or
   listens its level drives them all (focusedVoice, called beside faceCornerVoice). On a light ground they take the
   theme's ink, as the face always does (faceGround). */
const _fcDots = new Set();   // {face, el}
let _fcDotsFeed = null, _fcDotsSpec = null, _fcVoiceUntil = 0;

async function _fcDotsSpecGet() {
  if (!_fcDotsSpec) _fcDotsSpec = (typeof faceSpec === 'function' ? faceSpec() : Promise.resolve({})).catch(() => ({}));
  return _fcDotsSpec;
}

/** Draw the points into `host` at `size` pixels. Returns {stop()}; stopping the last one closes the feed. */
function fcDots(host, size = 160) {
  if (!host || typeof faceMount !== 'function') return { stop() {} };
  const canvas = document.createElement('canvas');
  canvas.className = 'fc-dots-canvas';
  canvas.style.width = canvas.style.height = `${size}px`;
  host.replaceChildren(canvas);
  const rec = { el: canvas, face: { set() {}, level() {}, stop() {} }, stopped: false };
  _fcDots.add(rec);
  _fcDotsSpecGet().then(spec => {
    if (rec.stopped) return;
    // Fewer points in a small circle, as the corner face has: the same points, at a count the size can show.
    const dots = size < 80 ? 140 : size < 200 ? 320 : 560;
    // Held in its form, as Ambient holds its galaxy (`c: 1` in every state): a button reads as the shape, not as noise.
    const steady = Object.fromEntries(Object.keys(FACE_STATES).map(k => [k, { ...(spec.states?.[k] || {}), c: 1 }]));
    rec.face = faceMount(canvas, { ...spec, dots, hud: false, grain: false, clear: true, vignette: false, settle: false, states: steady });
    if (!_fcDotsFeed && typeof faceFeed === 'function') _fcDotsFeed = faceFeed(s => { if (Date.now() > _fcVoiceUntil) _fcDots.forEach(d => d.face.set(s.state, s.detail)); });
  });
  return { stop() {
    rec.stopped = true; rec.face.stop(); _fcDots.delete(rec);
    if (!_fcDots.size && _fcDotsFeed) { _fcDotsFeed(); _fcDotsFeed = null; }
  } };
}

/** Every copy drawn again (the theme's ground changed: light points become ink). */
function fcDotsRedraw() {
  for (const d of [..._fcDots]) {
    const host = d.el.parentElement, size = parseInt(d.el.style.width, 10) || 160;
    if (!host) continue;
    d.stopped = true; d.face.stop(); _fcDots.delete(d);
    const again = fcDots(host, size);
    host._fcDots = again;
  }
}

/** A call's voice drives the points (chat-call.js through faceCornerVoice): its state and how loud. */
function focusedVoice(state, level) {
  if (!_fcDots.size) return;
  _fcVoiceUntil = Date.now() + 1500;
  _fcDots.forEach(d => { d.face.set(state); d.face.level(level); });
}

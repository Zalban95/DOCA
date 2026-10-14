'use strict';

/**
 * A watch's console played into a page (asked 2026-10-14: "link the watch's commands to Benchie and use the 6-axis
 * gyroscope … as well as buttons and toggles to play the game on the TV — all the tools to do it quickly, without
 * workarounds"). A console (device-console.js) can be linked to previews — a project's page served through the canvas
 * origin (canvas/previews.js) — as well as to devices. The page, wherever it shows (the panel's preview window, a TV
 * through the cast door), loads one script from its own address and hears the console:
 *
 *   <script src="/__doca/console.js"></script>
 *   docaConsole.addEventListener('frame',  e => e.detail)   // {t, accel?, gyro?, heading?, crown?}
 *   docaConsole.addEventListener('button', e => e.detail)   // {id: 'A'…'E', down, behaviour}
 *   docaConsole.addEventListener('state',  e => e.detail)   // {enabled, mode, toggles, joystick?}
 *
 * The script and its stream (`/__doca/console`, server-sent events) are answered by the canvas origin and the cast door
 * before anything reaches the app, for the preview that address serves (its cookie, or the cast's own preview): a page
 * hears only the consoles linked to its own preview. Input for a page, never for the harness — nothing here reaches a
 * model, a prompt or a transcript, like the rest of the console. In memory: a stream is only worth having live.
 */
const _subs = new Map();   // preview id → Set(res)

/** Every console linked to `previewId`, newest first: [{deviceId}] — read from device-console's own records. */
function consolesOf(previewId) {
  const all = require('./store').readJson(require('./device-console').DOC, {});
  return Object.keys(all).filter(id => require('./device-console').configOf(id).pages.includes(previewId));
}

/** From device-console.ingest: what a console just sent, to the pages its config names. */
function feed(deviceId, pages, payload) {
  for (const pid of pages) {
    const subs = _subs.get(pid);
    if (!subs?.size) continue;
    const lines = [];
    for (const f of payload.frames || []) lines.push(['frame', f]);
    if (payload.button) lines.push(['button', payload.button]);
    lines.push(['state', { deviceId, enabled: payload.enabled, mode: payload.mode, toggles: payload.toggles, ...(payload.joystick ? { joystick: payload.joystick } : {}) }]);
    const text = lines.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    for (const res of subs) { try { res.write(text); } catch { /* gone: its close removes it */ } }
  }
}

const SCRIPT = `/* DOCA: a watch's console for this page (modules/console-pages.js). */
(function () {
  if (window.docaConsole) return;
  var target = new EventTarget();
  target.connected = false;
  var src = new EventSource('/__doca/console');
  ['frame', 'button', 'state'].forEach(function (k) {
    src.addEventListener(k, function (e) { var d = null; try { d = JSON.parse(e.data); } catch (x) {} target.dispatchEvent(new CustomEvent(k, { detail: d })); });
  });
  src.onopen = function () { target.connected = true; target.dispatchEvent(new CustomEvent('open')); };
  src.onerror = function () { target.connected = false; };
  window.docaConsole = target;
})();
`;

/**
 * `/__doca/console.js` and `/__doca/console`, for the preview `previewId` (null: none here). Returns true when it
 * answered.
 */
function serve(req, res, preview) {
  const p = String(req.url || '').split('?')[0];
  if (p !== '/__doca/console.js' && p !== '/__doca/console') return false;
  if (p === '/__doca/console.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(SCRIPT);
    return true;
  }
  if (!preview) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No preview here.'); return true; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ consoles: consolesOf(preview.id).length })}\n\n`);
  if (!_subs.has(preview.id)) _subs.set(preview.id, new Set());
  _subs.get(preview.id).add(res);
  const beat = setInterval(() => { try { res.write(': still here\n\n'); } catch { /* closing */ } }, 25000);
  beat.unref?.();
  res.on('close', () => { clearInterval(beat); _subs.get(preview.id)?.delete(res); });
  return true;
}

/** How many pages hear a preview now (the tool's status line). */
const listeners = previewId => _subs.get(previewId)?.size || 0;

module.exports = { serve, feed, consolesOf, listeners, SCRIPT };

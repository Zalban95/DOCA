/* Sharing a phone's screen, where the page has no getDisplayMedia (Android's WebView has none): the app that holds the
   page does the capture and hands the pictures over — window.DocaDevice.shareScreen (DocaMobile ≥ 1.5.0; the contract
   is docs/api/fixtures/doca-device.json).

   The app asks Android (its own consent dialog), captures the screen with MediaProjection, and posts this page a
   MessagePort (window "message", data "doca-screen", only to the hub's own origin). On the port come JSON strings —
   {what: "started"|"size", width, height} in the screen's real pixels, {what: "ended"|"refused", why?} — and frames,
   each a JPEG as base64 (a string that does not start with "{"). The frames are drawn into a canvas and the canvas is
   what is sent (canvas.captureStream): a few frames a second at a modest size, enough to read a screen; the width and
   height said are the screen's own, which is what control (input_tap) is scaled to.

   meetDeviceScreen({fps, maxSide, onEnded, onSize}) → Promise<{stream, width, height}>     meetDeviceScreenStop() */
const _meetDev = { port: null, canvas: null, stream: null, onEnded: null, busy: false };

function meetDeviceScreenAvailable() { return typeof window !== 'undefined' && typeof window.DocaDevice?.shareScreen === 'function'; }

function meetDeviceScreen({ fps = 8, maxSide = 1280, onEnded = null, onSize = null, waitMs = 120000 } = {}) {
  if (!meetDeviceScreenAvailable()) return Promise.reject(new Error('This app cannot share its screen.'));
  meetDeviceScreenStop();
  return new Promise((resolve, reject) => {
    let settled = false, size = null;
    const fail = e => { if (settled) return; settled = true; cleanup(); reject(e); };
    const cleanup = () => { window.removeEventListener('message', onPort); clearTimeout(timer); };
    const timer = setTimeout(() => fail(new Error('The phone did not answer: the screen was not shared.')), waitMs);
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    const draw = async b64 => {
      if (drawing) return;          // a frame still decoding: this one is dropped, the next comes soon
      drawing = true;
      try {
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
        if (!settled && size) { settled = true; cleanup(); resolve({ stream: _meetDev.stream, width: size.width, height: size.height }); }
      } catch { /* a broken frame: the next one */ } finally { drawing = false; }
    };
    const onMessage = e => {
      const d = e.data;
      if (typeof d !== 'string') return;
      if (d[0] !== '{') return draw(d);
      let m; try { m = JSON.parse(d); } catch { return; }
      if (m.what === 'started' || m.what === 'size') { const turned = settled && size && (size.width !== (m.width | 0) || size.height !== (m.height | 0)); size = { width: m.width | 0, height: m.height | 0 }; if (turned) onSize?.(size); return; }
      if (m.what === 'refused') return fail(Object.assign(new Error(m.why || 'The screen was not shared.'), { name: 'NotAllowedError' }));
      if (m.what === 'ended') { const cb = _meetDev.onEnded; meetDeviceScreenStop(); if (!settled) fail(new Error(m.why || 'The share ended.')); else cb?.(m.why); }
    };
    function onPort(e) {
      if (e.data !== 'doca-screen' || !e.ports?.[0]) return;
      window.removeEventListener('message', onPort);
      const port = e.ports[0];
      _meetDev.port = port; port.onmessage = onMessage; port.start?.();
    }
    window.addEventListener('message', onPort);
    _meetDev.canvas = canvas; _meetDev.onEnded = onEnded; _meetDev.busy = true;
    _meetDev.stream = canvas.captureStream(fps);
    let answer;
    try { answer = String(window.DocaDevice.shareScreen(JSON.stringify({ fps, maxSide }))); } catch (e) { return fail(e); }
    if (answer === 'busy') return fail(new Error('The phone is already sharing its screen.'));
    if (answer !== 'asking') return fail(new Error(`The phone cannot share its screen (${answer}).`));
  });
}

/** Stop: the app stops capturing (its notification and Android's chip go), the canvas track ends. */
function meetDeviceScreenStop() {
  if (!_meetDev.busy) return;
  _meetDev.busy = false;
  try { _meetDev.port?.close(); } catch { /* closed */ }
  _meetDev.stream?.getTracks().forEach(t => t.stop());
  _meetDev.port = _meetDev.stream = _meetDev.canvas = _meetDev.onEnded = null;
  if (meetDeviceScreenAvailable()) try { window.DocaDevice.stopScreen(); } catch { /* the app is gone */ }
}

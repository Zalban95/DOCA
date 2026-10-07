/* ═══════════════════════════════════════════════════════
   Canvases: the page the agent made, in a window beside the chat.

   The page never runs here. It is framed from the canvas origin (its own port,
   modules/canvas/origin.js), sandboxed twice — by this iframe's `sandbox` and by
   the page's own CSP — so it has an opaque origin and cannot reach /api. It can
   talk to the panel only by postMessage, and only these, from this frame:
     { doca: 'send',  text }   put text in the chat box, for the user to send
     { doca: 'close' }         close the window
   Anything else is ignored. The chat floats above the window; on a phone the
   window is a full-screen sheet.
   ═══════════════════════════════════════════════════════ */

let _canvas = null;   // { id, frame, overlay }

function _canvasWindow() {
  let overlay = document.getElementById('canvas-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'canvas-overlay';
  overlay.className = 'canvas-overlay';
  overlay.innerHTML = `
    <div class="canvas-window" role="dialog" aria-label="Canvas">
      <div class="canvas-head">
        <span class="canvas-title" id="canvas-title"></span>
        <select class="input canvas-rev" id="canvas-rev" title="Revision"></select>
        <a class="btn btn-xs" id="canvas-newtab" target="_blank" rel="noopener noreferrer" title="Open in a tab of its own">↗</a>
        <button class="btn btn-xs" type="button" id="canvas-delete" onclick="canvasDelete()" title="Delete this canvas and all its revisions">🗑</button>
        <button class="btn btn-xs" type="button" onclick="canvasClose()" title="Close">✕</button>
      </div>
      <iframe class="canvas-frame" id="canvas-frame" title="Canvas"
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
              referrerpolicy="no-referrer"></iframe>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('canvas-rev').addEventListener('change', e => _canvasShow(Number(e.target.value)));
  return overlay;
}

/**
 * Open a preview of a localhost port (modules/canvas/previews.js). Unlike a
 * canvas page it is an app that talks to its own server, so it keeps the canvas
 * origin (allow-same-origin) — which holds nothing of the panel's.
 */
async function canvasPreviewOpen(id, at = '/') {
  let info;
  try { info = await apiFetch(`/api/harness/previews/${encodeURIComponent(id)}`); }
  catch (e) { appAlert(`Could not open the preview: ${e.message}`); return; }
  const overlay = _canvasWindow();
  const frame = document.getElementById('canvas-frame');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin');
  const url = `${location.protocol}//${location.hostname}:${info.canvasPort}${info.path}${at}`;
  _canvas = { id, base: null, frame };
  document.getElementById('canvas-title').textContent = `${info.preview.title} · ${info.preview.where || `localhost:${info.preview.port}`}`;
  document.getElementById('canvas-rev').style.display = 'none';
  document.getElementById('canvas-delete').style.display = 'none';
  document.getElementById('canvas-newtab').href = url;
  overlay.style.display = 'flex';
  frame.src = url;
}

/** Open a canvas at a revision (the latest when omitted). */
async function canvasOpen(id, rev) {
  let info;
  try { info = await apiFetch(`/api/harness/canvases/${encodeURIComponent(id)}`); }
  catch (e) { appAlert(`Could not open the canvas: ${e.message}`); return; }
  const overlay = _canvasWindow();
  const base = `${location.protocol}//${location.hostname}:${info.port}${info.path}`;
  _canvas = { id, base, frame: document.getElementById('canvas-frame') };
  // A page of the agent's: sandboxed to an opaque origin, whatever a preview set before.
  _canvas.frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-downloads');
  document.getElementById('canvas-rev').style.display = '';
  document.getElementById('canvas-delete').style.display = '';
  document.getElementById('canvas-title').textContent = info.canvas.title;
  const sel = document.getElementById('canvas-rev');
  sel.innerHTML = '';
  for (const r of [...info.canvas.revisions].reverse()) {
    const o = document.createElement('option');
    o.value = r.rev;
    o.textContent = `rev ${r.rev} · ${new Date(r.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
    sel.appendChild(o);
  }
  const want = rev || info.canvas.revisions.at(-1).rev;
  sel.value = String(want);
  overlay.style.display = 'flex';
  _canvasShow(want);
}

function _canvasShow(rev) {
  if (!_canvas) return;
  const url = `${_canvas.base}/${rev}`;
  _canvas.frame.src = url;
  document.getElementById('canvas-newtab').href = url;
}

/** Delete the open canvas (every revision); its chips then say it is gone. */
function canvasDelete() {
  if (!_canvas?.base) return;   // a preview is not deleted, it expires
  const id = _canvas.id;
  appConfirm('Delete this canvas and all its revisions?', async () => {
    try { await apiFetch(`/api/harness/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' }); canvasClose(); }
    catch (e) { appAlert(`Could not delete it: ${e.message}`); }
  });
}

function canvasClose() {
  const overlay = document.getElementById('canvas-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  if (_canvas) _canvas.frame.src = 'about:blank';   // stop whatever it was running
  _canvas = null;
}

/** The chat box the user is looking at: the Harness tab's, or the floating one. */
function _canvasChatInput() {
  if (document.body.classList.contains('harness-tab')) return document.getElementById('hc-input');
  if (typeof chatOpen !== 'undefined' && !chatOpen && typeof toggleChat === 'function') toggleChat();
  return document.getElementById('chat-input');
}

/**
 * "Save this" and "open a file", asked by the page. The page cannot reach the
 * panel or the disk (opaque origin, connect-src 'none'), so it asks, and the
 * person decides: where a save goes, and whether — and which — file is handed
 * in. The answer goes back to the page as { doca: 'saved' | 'opened' | 'refused', … }.
 */
const CANVAS_MAX_FILE = 5 << 20;
function _canvasReply(frame, msg) { try { frame.contentWindow.postMessage(msg, '*'); } catch { /* closed */ } }

async function _canvasSave(frame, d) {
  if (typeof d.text !== 'string' || d.text.length > CANVAS_MAX_FILE) return _canvasReply(frame, { doca: 'refused', what: 'save', reason: 'text only, up to 5 MB' });
  const name = String(d.name || 'canvas.txt').replace(/[\\/\0]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'canvas.txt';
  let dir = '';
  try { dir = (await apiFetch('/api/paths')).workspaceDir || ''; } catch { /* no default then */ }
  appPrompt(`This canvas wants to save "${name}" (${Math.ceil(d.text.length / 1024)} KB). Save it where?`, async to => {
    try {
      await apiFetch('/api/files/write', { method: 'POST', body: { path: to, content: d.text } });
      _canvasReply(frame, { doca: 'saved', path: to });
    } catch (e) { appAlert(`Could not save it: ${e.message}`); _canvasReply(frame, { doca: 'refused', what: 'save', reason: e.message }); }
  }, dir ? `${dir.replace(/\/+$/, '')}/${name}` : name);
}

function _canvasOpen(frame, d) {
  appConfirm('This canvas asks for a file from this device. Choose one to hand it?', () => {
    // Inside the click on "OK": the one moment a browser lets a page open a file picker.
    const pick = Object.assign(document.createElement('input'), { type: 'file' });
    if (typeof d.accept === 'string') pick.accept = d.accept.slice(0, 200);
    pick.onchange = () => {
      const f = pick.files?.[0];
      if (!f) return _canvasReply(frame, { doca: 'refused', what: 'open', reason: 'no file chosen' });
      if (f.size > CANVAS_MAX_FILE) return _canvasReply(frame, { doca: 'refused', what: 'open', reason: 'larger than 5 MB' });
      const text = /^text\/|json|xml|javascript|csv|svg/.test(f.type) || /\.(txt|md|csv|json|js|ts|html|css|svg|xml|ya?ml|py|kt|java|c|h|cpp|rs|go|sh)$/i.test(f.name);
      const r = new FileReader();
      r.onload = () => _canvasReply(frame, { doca: 'opened', name: f.name, type: f.type, size: f.size, ...(text ? { text: r.result } : { dataUrl: r.result }) });
      if (text) r.readAsText(f); else r.readAsDataURL(f);
    };
    pick.click();
  }, () => _canvasReply(frame, { doca: 'refused', what: 'open', reason: 'the person said no' }));
}

// Only in a browser: tests evaluate these scripts without one.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('message', e => {
    // Only the frame we opened; its origin is opaque ("null"), so the source is the check.
    if (!_canvas || e.source !== _canvas.frame.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.doca === 'close') return canvasClose();
    if (d.doca === 'save') return _canvasSave(_canvas.frame, d);
    if (d.doca === 'open') return _canvasOpen(_canvas.frame, d);
    if (d.doca === 'send' && typeof d.text === 'string') {
      const input = _canvasChatInput();
      if (!input) return;
      input.value = d.text.slice(0, 20000);
      input.dispatchEvent(new Event('input'));
      input.focus();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('canvas-overlay')?.style.display === 'flex') canvasClose();
  });
}

/* Sharing a screen, and handing someone control of it — consent first (modules/meetings/control.js).

   Sharing is always started here, by the person sharing, with the browser's own picker (getDisplayMedia; the same in
   DocaDesk's WebView2) — and while it lasts a red bar says so with Stop. Control is only of a screen being shared, only
   to someone the sharer names on a machine of theirs that a DOCA client lends (consent 1), and only once they confirm
   having been told what it means (consent 2). The controller's pointer and keys travel over a socket to the hub, which
   hands them to that machine's own input tools; everyone sees a label with the controller's name where they point.
   The sharer stops it at once: Stop control, Stop sharing, or Esc three times on this page. */

async function meetShareStart() {
  if (!MEET.id) return;
  // A phone app's web view has no getDisplayMedia: the app captures the screen itself (meet/device-screen.js).
  if (!navigator.mediaDevices?.getDisplayMedia && typeof meetDeviceScreenAvailable === 'function' && meetDeviceScreenAvailable()) return _meetShareFromApp();
  if (!navigator.mediaDevices?.getDisplayMedia) return appAlert('This browser cannot share a screen (no getDisplayMedia). A desktop browser, DocaDesk or the phone app can.');
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
  catch (e) { if (e?.name !== 'NotAllowedError') appAlert(`The screen was not shared: ${e.message}`); return; }
  const track = stream.getVideoTracks()[0], s = track?.getSettings?.() || {};
  track.onended = () => meetShareStop();   // the browser's own "Stop sharing" button
  await _meetShareBegin(stream, s);
}

/** The phone's own screen, through its app: Android asks, the app sends pictures, the size is the screen's own. */
async function _meetShareFromApp() {
  let got;
  // A phone turned: the share's size follows, so a controller's tap still lands where they point.
  const onSize = sz => { if (MEET.screen) _meetPost('share', { on: true, streamId: MEET.screen.id, width: sz.width, height: sz.height, surface: 'monitor' }).catch(() => {}); };
  try { got = await meetDeviceScreen({ onEnded: () => meetShareStop(), onSize }); }
  catch (e) { if (e?.name !== 'NotAllowedError') appAlert(`The screen was not shared: ${e.message}`); return; }
  await _meetShareBegin(got.stream, { width: got.width, height: got.height, displaySurface: 'monitor' });
}

async function _meetShareBegin(stream, s) {
  MEET.screen = stream;
  _meetTracks();
  try { await _meetPost('share', { on: true, streamId: stream.id, width: s.width, height: s.height, surface: s.displaySurface }); }
  catch (e) { appAlert(e.message); }
  meetDraw();
}

async function meetShareStop() {
  const s = MEET.screen;
  if (!s) return;
  MEET.screen = null;
  s.getTracks().forEach(t => { t.onended = null; t.stop(); });
  if (typeof meetDeviceScreenStop === 'function') meetDeviceScreenStop();
  _meetTracks();
  if (MEET.id && MEET.me) await _meetPost('share', { on: false }).catch(() => {});
  meetDraw();
}

/** The room's news about control (rooms.js passes what is not its own). */
function meetShareHeard(c) {
  if (c.what === 'control-request' && c.to === MEET.me) {
    return appConfirm(`${c.name} asks to control your screen. Let them? You choose the machine and confirm next; you can stop it any time.`, () => meetControlOffer(c.personId));
  }
  if (c.what === 'control') {
    MEET.grants = [...MEET.grants.filter(g => g.id !== c.grant.id), c.grant];
    const mine = c.grant.controller.peer === MEET.me;
    if (mine) meetControlSocket(c.grant.state === 'active' ? c.grant : null);
    if (c.grant.state === 'ended' && (mine || c.grant.sharer.peer === MEET.me) && c.why) _meetNote(`Control ended: ${c.why}.`);
    return meetDraw();
  }
  if (c.what === 'pointer') return _meetPointer(c);
  if (c.what === 'control-error' && c.to === MEET.me) return _meetNote(`${c.error}`);
}

function _meetNote(text) {
  const root = document.getElementById('meet');
  if (!root) return;
  const n = Object.assign(document.createElement('div'), { className: 'meet-note', textContent: text });
  root.appendChild(n);
  setTimeout(() => n.remove(), 5000);
}

async function meetControlAsk(peer) {
  try { const r = await _meetPost('control/request', { to: peer }); _meetNote(`Asked ${r.asked}: they decide.`); } catch (e) { appAlert(e.message); }
}

/** Consent 1 (whom, on which machine) then consent 2 (the confirmation that says what it means). */
async function meetControlOffer(personId = null) {
  const people = [...MEET.peers.values()].filter(p => p.personId);
  let devices = [];
  try { devices = (await apiFetch('/api/meetings/devices')).devices || []; } catch { /* the offer says why */ }
  const root = document.getElementById('meet');
  root?.querySelector('.meet-offer')?.remove();
  const box = Object.assign(document.createElement('form'), { className: 'meet-offer' });
  box.innerHTML = `<b>Let someone control your screen</b>
    <label>Who <select class="input" name="to">${people.map(p => `<option value="${escHtml(p.personId)}"${p.personId === personId ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('')}</select></label>
    <label>Which machine is this screen <select class="input" name="device">${devices.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.name)}</option>`).join('') || '<option value="">none can take input now</option>'}</select></label>
    <p class="meet-quiet">Control goes through ${escHtml((typeof BRAND !== 'undefined' && BRAND.product) || 'the hive')}'s app on that machine (the desktop app, or the phone app). A screen shared from a plain browser can be seen, not controlled.</p>
    <div><button class="btn btn-primary" type="submit">Next</button> <button class="btn" type="button" onclick="this.closest('form').remove()">Cancel</button></div>`;
  box.onsubmit = async e => {
    e.preventDefault();
    const to = box.elements.to.value, device = box.elements.device.value || undefined;
    box.remove();
    try {
      const r = await _meetPost('control/offer', { to, device });
      appConfirm(r.confirm, async () => {
        try { await _meetPost('control/confirm', { grant: r.grant.id }); } catch (err) { appAlert(err.message); }
      }, () => _meetPost('control/revoke', { grant: r.grant.id }).catch(() => {}));
    } catch (err) { appAlert(err.message); }
  };
  root?.appendChild(box);
}

function meetControlRevoke() { _meetPost('control/revoke').catch(e => appAlert(e.message)); }

// Esc three times within two seconds, on this page, ends any control of this page's screen.
let _meetEsc = [];
document.addEventListener?.('keydown', e => {
  if (e.key !== 'Escape' || !MEET.id || !MEET.grants.some(g => g.state === 'active' && g.sharer.peer === MEET.me)) return;
  const now = Date.now();
  _meetEsc = [..._meetEsc.filter(t => now - t < 2000), now];
  if (_meetEsc.length >= 3) { _meetEsc = []; meetControlRevoke(); }
});

/** Everyone sees where the controller points, with their name. */
function _meetPointer(c) {
  const stage = document.querySelector('#meet .meet-stage'), layer = stage?.querySelector('.meet-pointers'), v = stage?.querySelector('video');
  if (!layer || !v) return;
  const r = _meetContentBox(v);
  let tag = layer.querySelector(`[data-by="${CSS.escape(c.by)}"]`);
  if (!tag) { tag = Object.assign(document.createElement('div'), { className: 'meet-pointer' }); tag.dataset.by = c.by; tag.textContent = `↖ ${c.by}`; layer.appendChild(tag); }
  tag.style.left = `${r.x + c.fx * r.w}px`; tag.style.top = `${r.y + c.fy * r.h}px`;
  tag.classList.toggle('meet-click', !!c.click);
  clearTimeout(tag._t); tag._t = setTimeout(() => tag.remove(), 4000);
}

/** Where the picture really is inside a video element that letterboxes it (object-fit: contain). */
function _meetContentBox(v) {
  const W = v.clientWidth, H = v.clientHeight, vw = v.videoWidth || W, vh = v.videoHeight || H;
  const k = Math.min(W / vw, H / vh), w = vw * k, h = vh * k;
  return { x: v.offsetLeft + (W - w) / 2, y: v.offsetTop + (H - h) / 2, w, h };
}

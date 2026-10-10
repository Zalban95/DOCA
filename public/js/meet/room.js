/* A meeting's room, drawn over the panel (modules/meetings): every person's camera, a shared screen large, the room's
   chat, and the controls — microphone, camera, share, chat, leave. It stays when the panel's page changes and folds to
   a small tile (–) so a person can share their screen and keep working in the panel.

   A page joins with its live stream's id (lib/live.js: the hub knows a page by it) and hears the room on the live
   feed's `meeting` topic: who joined and left, the other pages' signalling (meet/mesh.js), shares, chat, control
   (meet/share.js). When the stream reconnects it is a new page to the hub, so it joins again by itself.

   meetJoin(id)  open a meeting's room on this page            meetLeave()  leave it (the organizer may end it for all) */
const MEET = { id: null, meeting: null, me: null, peers: new Map(), local: null, screen: null, mesh: null, off: null, chat: [], mic: true, cam: true,
  folded: false, back: null, grants: [], joining: false, pending: [] };

/** This page's live stream id, once the hub has said it (lib/live.js). */
async function _meetScreen() {
  for (let i = 0; i < 100; i++) { if (typeof _liveScreen !== 'undefined' && _liveScreen) return _liveScreen; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('The live stream did not open: is the hub reachable?');
}

const _meetPost = (path, body = {}) => apiFetch(`/api/meetings/${MEET.id}/${path}`, { method: 'POST', body: { screen: MEET.me, ...body } });

async function meetJoin(id) {
  id = String(id || '').trim().replace(/^.*\/meet\//, '').replace(/[^a-z0-9]/gi, '');
  if (!id) return;
  if (MEET.id === id) { meetFold(false); return; }
  if (MEET.id) await meetLeave();
  MEET.id = id; MEET.joining = true; MEET.peers.clear(); MEET.chat = []; MEET.grants = []; MEET.pending = [];
  meetDraw();
  if (!MEET.off) MEET.off = liveOn('meeting', _meetHeard);
  try {
    if (!MEET.local) await _meetMedia();
    MEET.me = await _meetScreen();
    const r = await _meetPost('join', { media: { audio: MEET.mic, video: MEET.cam } });
    MEET.meeting = r.meeting; MEET.chat = r.chat || [];
    MEET.mesh = meetMesh({ me: MEET.me, iceServers: r.iceServers || [], send: (to, data) => _meetPost('signal', { to, data }).catch(() => {}),
      onTrack: _meetTrack, onState: (peer, state) => { const p = MEET.peers.get(peer); if (p) { p.state = state; meetDraw(); } } });
    _meetTracks();
    for (const s of MEET.pending.splice(0)) MEET.mesh.signal(s.from, s.data);
    for (const p of r.room.peers) if (p.peer !== MEET.me) { MEET.peers.set(p.peer, { ...p, streams: new Map() }); MEET.mesh.add(p.peer); }
    MEET.grants = r.meeting.control || [];
    if (typeof meetAppSay === 'function') meetAppSay(true);   // the app holding the page keeps the call alive (meet/app.js)
    if (!MEET.back && typeof overlayBack === 'function') MEET.back = overlayBack(() => { MEET.back = null; meetFold(true); });
  } catch (e) {
    const id0 = MEET.id; _meetReset();
    appAlert(`Could not join the meeting ${id0}: ${e.message}`);
  } finally { MEET.joining = false; meetDraw(); }
}

/** Microphone and camera: what this browser lets the page have — a person with neither still joins to see and hear. */
async function _meetMedia() {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) { MEET.mic = MEET.cam = false; return; }
  for (const want of [{ audio: true, video: { width: 640, height: 360 } }, { audio: true }, { video: true }]) {
    try { MEET.local = await md.getUserMedia(want); break; } catch { /* the next, smaller ask */ }
  }
  MEET.mic = !!MEET.local?.getAudioTracks().length; MEET.cam = !!MEET.local?.getVideoTracks().length;
}

/** What this page sends to every other: its microphone and camera, and the screen it shares. */
function _meetTracks() {
  const list = [];
  for (const t of MEET.local?.getTracks() || []) list.push({ track: t, stream: MEET.local });
  for (const t of MEET.screen?.getVideoTracks() || []) list.push({ track: t, stream: MEET.screen });
  MEET.mesh?.setTracks(list);
}

function _meetTrack(peer, track, stream) {
  let p = MEET.peers.get(peer);
  if (!p) { p = { peer, name: '…', streams: new Map() }; MEET.peers.set(peer, p); }
  p.streams.set(stream.id, stream);
  stream.onremovetrack = () => { if (!stream.getTracks().length) { p.streams.delete(stream.id); meetDraw(); } };
  track.onended = () => meetDraw();
  meetDraw();
}

/** What the room says: each change as rooms.js and control.js tell it. */
function _meetHeard(c) {
  if (c.what === 'ring') return typeof meetingsRing === 'function' && meetingsRing(c);
  if (c.what === 'resync') { if (MEET.id && !MEET.joining) { const id = MEET.id; _meetReset(true); meetJoin(id); } return; }
  if (!MEET.id || c.id !== MEET.id) return;
  const p = MEET.peers.get(c.peer);
  switch (c.what) {
    case 'joined': if (c.peer !== MEET.me && !p) { MEET.peers.set(c.peer, { peer: c.peer, name: c.name, personId: c.personId, streams: new Map() }); MEET.mesh?.add(c.peer); } break;
    case 'left': MEET.peers.delete(c.peer); MEET.mesh?.remove(c.peer); break;
    case 'signal':
      if (c.to !== MEET.me) return;
      if (!MEET.peers.has(c.from)) MEET.peers.set(c.from, { peer: c.from, name: '…', streams: new Map() });
      if (MEET.mesh) MEET.mesh.signal(c.from, c.data); else MEET.pending.push(c);   // before the join's answer: kept, then played
      return;
    case 'media': if (p) p.media = c.media; break;
    case 'shared': if (p) p.sharing = c.sharing; if (c.peer === MEET.me && !c.sharing && MEET.screen) meetShareStop(true); break;
    case 'said': MEET.chat.push(c.line); break;
    case 'closed': { const why = c.why; _meetReset(); appAlert(`The meeting ended: ${why}.`); return; }
    default: if (typeof meetShareHeard === 'function') meetShareHeard(c); return;
  }
  meetDraw();
}

function meetMic() { MEET.mic = !MEET.mic; MEET.local?.getAudioTracks().forEach(t => { t.enabled = MEET.mic; }); _meetPost('media', { audio: MEET.mic, video: MEET.cam }).catch(() => {}); meetDraw(); }
function meetCam() { MEET.cam = !MEET.cam; MEET.local?.getVideoTracks().forEach(t => { t.enabled = MEET.cam; }); _meetPost('media', { audio: MEET.mic, video: MEET.cam }).catch(() => {}); if (typeof meetAppSay === 'function') meetAppSay(true); meetDraw(); }

async function meetSay(form) {
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return false;
  input.value = '';
  try { await _meetPost('say', { text }); } catch (e) { appAlert(e.message); }
  return false;
}

/** Leave: this page goes; the room goes on for the others. The organizer may end it for everyone instead. */
async function meetLeave(forAll = false) {
  if (!MEET.id) return;
  const id = MEET.id;
  if (MEET.screen) await meetShareStop(true);
  try { if (forAll) await apiFetch(`/api/meetings/${id}/end`, { method: 'POST' }); else if (MEET.me) await _meetPost('leave'); } catch { /* gone already */ }
  _meetReset();
}

function _meetReset(keepLocal = false) {
  MEET.mesh?.close(); MEET.mesh = null;
  if (!keepLocal) { MEET.local?.getTracks().forEach(t => t.stop()); MEET.local = null; MEET.screen?.getTracks().forEach(t => t.stop()); MEET.screen = null; }
  if (MEET.id && typeof meetAppSay === 'function') meetAppSay(false);
  MEET.id = null; MEET.meeting = null; MEET.me = null; MEET.peers.clear(); MEET.grants = []; MEET.audio = null; MEET.pip = false;
  if (typeof meetControlSocket === 'function') meetControlSocket(null);
  if (MEET.back) { const b = MEET.back; MEET.back = null; b(); }
  meetDraw();
}

function meetFold(on = !MEET.folded) { MEET.folded = on; meetDraw(); }

/** The link to this meeting, on the clipboard. */
function meetCopyLink() {
  const link = MEET.meeting?.link || `${location.origin}/meet/${MEET.id}`;
  navigator.clipboard?.writeText(link).then(() => appAlert(`Copied: ${link}`), () => appAlert(link));
}

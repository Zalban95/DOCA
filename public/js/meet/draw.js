/* The room, drawn (meet/room.js holds its state). Video elements are kept across redraws — one per stream, moved into
   each new frame — so a redraw never restarts a picture or a voice. A shared screen takes the stage; cameras are the
   tiles beside it; the bar at the bottom has the controls; a red bar says so whenever this page shares its screen. */
const _meetVideos = new Map();   // key → <video>

function _meetVideo(key, stream, muted = false) {
  let v = _meetVideos.get(key);
  if (!v) { v = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted }); v.dataset.key = key; _meetVideos.set(key, v); }
  if (v.srcObject !== stream) { v.srcObject = stream; v.play?.().catch(() => {}); }
  return v;
}

/** A peer's camera stream and its screen stream, told apart by the id its share announced. */
function _meetStreams(p) {
  const all = [...(p.streams?.values() || [])].filter(s => s.getTracks().some(t => t.readyState !== 'ended'));
  const screen = p.sharing?.streamId ? all.find(s => s.id === p.sharing.streamId) : null;
  return { screen, camera: all.find(s => s !== screen && s.getVideoTracks().length) || all.find(s => s !== screen) || null };
}

const _meetIcon = (on, a, b) => (on ? a : b);

function meetDraw() {
  let root = document.getElementById('meet');
  if (!MEET.id) { root?.remove(); for (const v of _meetVideos.values()) v.srcObject = null; _meetVideos.clear(); return; }
  if (!root) { root = Object.assign(document.createElement('div'), { id: 'meet', className: 'meet' }); document.body.appendChild(root); }
  const m = MEET.meeting || { title: 'Joining…', id: MEET.id };
  const peers = [...MEET.peers.values()];
  const sharer = MEET.screen ? { me: true, name: 'You', stream: MEET.screen } : peers.map(p => ({ p, ...(_meetStreams(p)) })).filter(x => x.p.sharing && x.screen).map(x => ({ peer: x.p.peer, name: x.p.name, stream: x.screen, sharing: x.p.sharing }))[0] || null;
  const mine = MEET.grants.find(g => g.state !== 'ended' && g.sharer.peer === MEET.me);
  const held = MEET.grants.find(g => g.state === 'active' && g.controller.peer === MEET.me);
  root.className = `meet${MEET.folded ? ' meet-folded' : ''}${MEET.pip ? ' meet-pip' : ''}${sharer ? ' meet-has-stage' : ''}${MEET.chatOpen ? ' meet-chat-open' : ''}`;
  const count = peers.length + 1;
  const typing = root.querySelector('.meet-say input'), draft = typing?.value || '', focused = typing && document.activeElement === typing;
  const tiles = [`<div class="meet-tile meet-me"><div class="meet-v" data-v="me"></div><span class="meet-name">You${MEET.mic ? '' : ' · muted'}</span></div>`,
    ...peers.map(p => `<div class="meet-tile${p.state === 'failed' ? ' meet-lost' : ''}"><div class="meet-v" data-v="cam:${escHtml(p.peer)}"></div>
      <span class="meet-name">${escHtml(p.name || '…')}${p.media && !p.media.audio ? ' · muted' : ''}${p.state && !['connected', 'new', 'connecting'].includes(p.state) ? ` · ${escHtml(p.state)}` : ''}</span></div>`)];
  root.innerHTML = `
    ${MEET.screen ? `<div class="meet-red" role="status">● You are sharing your screen${mine?.state === 'active' ? ` — <b>${escHtml(mine.controller.name)}</b> is controlling ${escHtml(mine.device?.name || 'it')} (Esc ×3 stops)` : ''}
      ${mine?.state === 'active' ? '<button type="button" class="btn btn-xs" onclick="meetControlRevoke()">Stop control</button>' : ''}
      <button type="button" class="btn btn-xs" onclick="meetShareStop()">Stop sharing</button></div>` : ''}
    <div class="meet-head"><span class="meet-title">${escHtml(m.title)}</span><span class="meet-id" title="The call id: anyone invited joins with it or the link">${escHtml(MEET.id)}</span>
      <span class="meet-count">${count} of ${escHtml(String(MEET.meeting?.room?.max || 6))}</span>
      <span class="meet-head-acts"><button type="button" class="btn btn-xs" onclick="meetCopyLink()" title="Copy the link">Link</button>
      <button type="button" class="btn btn-xs" onclick="meetFold()" title="${MEET.folded ? 'Open the room' : 'Keep it small and use the panel'}">${MEET.folded ? '⤢' : '–'}</button></span></div>
    <div class="meet-body">
      ${sharer ? `<div class="meet-stage${held ? ' meet-controlling' : ''}"><div class="meet-v" data-v="stage"></div><div class="meet-pointers"></div>
        <div class="meet-stage-cap">${sharer.me ? 'Your screen' : `${escHtml(sharer.name)}'s screen`}${held ? ' — you have control: your pointer and keys go to it' : ''}
        ${!sharer.me && !held ? `<button type="button" class="btn btn-xs" onclick="meetControlAsk('${escHtml(sharer.peer)}')">Ask to control</button>` : ''}
        ${held ? '<button type="button" class="btn btn-xs" onclick="meetControlRevoke()">Let go</button>' : ''}</div></div>` : ''}
      <div class="meet-grid meet-n${Math.min(count, 6)}">${tiles.join('')}</div>
      <aside class="meet-side"><div class="meet-people">${[`You`, ...peers.map(p => escHtml(p.name || '…'))].map(n => `<span>${n}</span>`).join('')}</div>
        <div class="meet-chat">${MEET.chat.map(l => `<div class="meet-line"><b>${escHtml(l.name)}</b> ${escHtml(l.text)}</div>`).join('') || '<div class="meet-line meet-quiet">Messages here are for everyone in the room.</div>'}</div>
        <form class="meet-say" onsubmit="return meetSay(this)"><input class="input" type="text" placeholder="Message the room" maxlength="2000"><button class="btn btn-xs" type="submit">Send</button></form></aside>
    </div>
    <div class="meet-ctl">
      <button type="button" class="btn${MEET.mic ? '' : ' meet-off'}" onclick="meetMic()" title="Microphone">${_meetIcon(MEET.mic, '🎙 Mic', '🔇 Muted')}</button>
      <button type="button" class="btn${MEET.cam ? '' : ' meet-off'}" onclick="meetCam()" title="Camera">${_meetIcon(MEET.cam, '📷 Camera', '📷 Off')}</button>
      <button type="button" class="btn${MEET.screen ? ' meet-on' : ''}" onclick="${MEET.screen ? 'meetShareStop()' : 'meetShareStart()'}">${MEET.screen ? '■ Stop sharing' : '🖥 Share screen'}</button>
      ${MEET.screen && peers.length ? '<button type="button" class="btn" onclick="meetControlOffer()" title="Let someone in the room move your pointer and type — you confirm, and stop it any time">Let someone control…</button>' : ''}
      ${typeof meetAudioRoute === 'function' && (MEET.audio || meetAudioRoute())?.available?.length > 1 ? `<button type="button" class="btn" onclick="meetAudioNext()" title="Where the sound goes">${escHtml({ speaker: '🔊 Speaker', earpiece: '📞 Earpiece', headset: '🎧 Headset' }[MEET.audio.route] || '🔊 Sound')}</button>` : ''}
      <button type="button" class="btn" onclick="MEET.chatOpen = !MEET.chatOpen; meetDraw()">💬 Chat${MEET.chat.length ? ` (${MEET.chat.length})` : ''}</button>
      <button type="button" class="btn btn-red" onclick="meetLeave()">Leave</button>
      ${MEET.meeting?.organizer ? '<button type="button" class="btn btn-red" onclick="appConfirm(\'End the meeting for everyone?\', () => meetLeave(true))">End for all</button>' : ''}
    </div>`;
  // The kept videos, into the new frame.
  const place = (key, stream, muted) => { const slot = root.querySelector(`[data-v="${CSS.escape(key)}"]`); if (slot && stream) slot.appendChild(_meetVideo(key, stream, muted)); };
  place('me', MEET.local && MEET.cam ? MEET.local : null, true);
  for (const p of peers) place(`cam:${p.peer}`, _meetStreams(p).camera, false);
  if (sharer) place('stage', sharer.stream, true);
  // A peer's screen carries no sound; its voice plays from its camera tile — or, with no camera, from a hidden one.
  for (const p of peers) { const s = _meetStreams(p); if (!s.camera && s.screen) { const a = _meetVideo(`aud:${p.peer}`, s.screen); a.className = 'meet-hidden'; root.appendChild(a); } }
  const keep = new Set([...root.querySelectorAll('video')].map(v => v.dataset.key));
  for (const [k, v] of _meetVideos) if (!keep.has(k)) { v.srcObject = null; _meetVideos.delete(k); }
  const chat = root.querySelector('.meet-chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  const input = root.querySelector('.meet-say input'); if (input) { input.value = draft; if (focused) input.focus(); }   // a redraw keeps what is being typed
  if (typeof meetControlBind === 'function') meetControlBind(root.querySelector('.meet-stage'), held, sharer);
}

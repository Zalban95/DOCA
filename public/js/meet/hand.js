/* The controller's hand: while the sharer has given this page control (two consents, meet/share.js), the pointer over
   the shared screen and the keys pressed on it go to the hub over /ws/meet/<id> (modules/meetings/socket.js), as
   fractions of the picture — the hub turns them into that machine's pixels and its own input tools. Nothing is sent
   without an active grant, and the socket closes the moment the grant ends. */
let _meetWs = null, _meetGrant = null, _meetMoveAt = 0;

/** Open the socket for an active grant, or close it (null). */
function meetControlSocket(grant) {
  if (!grant) { _meetGrant = null; try { _meetWs?.close(); } catch { /* closed */ } _meetWs = null; return; }
  _meetGrant = grant;
  if (_meetWs && _meetWs.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _meetWs = new WebSocket(`${proto}://${location.host}/ws/meet/${encodeURIComponent(MEET.id)}?screen=${encodeURIComponent(MEET.me)}`);
  _meetWs.onmessage = e => { try { const m = JSON.parse(e.data); if (m.error) _meetNote(m.error); } catch { /* not ours */ } };
  _meetWs.onclose = () => { _meetWs = null; };
}

function _meetSend(ev) {
  if (!_meetGrant || _meetWs?.readyState !== 1) return;
  _meetWs.send(JSON.stringify({ grant: _meetGrant.id, ...ev }));
}

/** Where on the picture (0–1 each way) a pointer event is, or null outside it. */
function _meetFrac(v, e) {
  const box = v.getBoundingClientRect(), vw = v.videoWidth || box.width, vh = v.videoHeight || box.height;
  const k = Math.min(box.width / vw, box.height / vh), w = vw * k, h = vh * k;
  const fx = (e.clientX - box.left - (box.width - w) / 2) / w, fy = (e.clientY - box.top - (box.height - h) / 2) / h;
  return fx < 0 || fy < 0 || fx > 1 || fy > 1 ? null : { fx: +fx.toFixed(4), fy: +fy.toFixed(4) };
}

const _MEET_KEYS = { Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end',
  PageUp: 'pageup', PageDown: 'pagedown', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'space' };

/** A key as the machine's input_keys names it ("ctrl+c", "enter", "f5"), or text to type. */
function meetKeyOf(e) {
  const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'win'].filter(Boolean);
  const named = _MEET_KEYS[e.key] || (/^F([1-9]|1[0-2])$/.test(e.key) ? e.key.toLowerCase() : null);
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) return { kind: 'type', text: e.key };
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const k = named || (e.key.length === 1 ? e.key.toLowerCase() : null);
  if (!k) return null;
  return { kind: 'keys', keys: [...mods.filter(m => !(m === 'shift' && !named && !e.ctrlKey && !e.altKey)), k].join('+') };
}

/** Bind the stage's picture to the hand while this page holds control; unbind when not. */
function meetControlBind(stage, held) {
  const v = stage?.querySelector('video');
  if (!v || !held) return;
  stage.tabIndex = 0;
  v.onpointermove = e => { if (Date.now() - _meetMoveAt < 60) return; _meetMoveAt = Date.now(); const f = _meetFrac(v, e); if (f) _meetSend({ kind: 'move', ...f }); };
  v.onclick = e => { const f = _meetFrac(v, e); if (f) _meetSend({ kind: 'click', ...f }); stage.focus(); };
  v.ondblclick = e => { const f = _meetFrac(v, e); if (f) _meetSend({ kind: 'click', double: true, ...f }); };
  v.oncontextmenu = e => { e.preventDefault(); const f = _meetFrac(v, e); if (f) _meetSend({ kind: 'click', button: 'right', ...f }); };
  stage.onkeydown = e => { const k = meetKeyOf(e); if (!k) return; e.preventDefault(); _meetSend(k); };
}

'use strict';

/**
 * A VNC target's console through the hub: WS /ws/vnc/:id (the upgrade router, terminal.js, has already demanded the
 * host right, a recent sign-in and this panel's own page). The hub signs in to the server itself — with the password
 * from keys/vnc.json — and then speaks to the browser's noVNC as a server that asks for none, so **the password never
 * reaches a browser**. After both handshakes the bytes are carried as they are, with one exception: a socket that only
 * watches (no `?drive=1`) has its keys, pointer, clipboard and power requests dropped here, so "view only" does not
 * rest on the page's word. A take-over socket counts as a person at the keyboard (state.js) until it closes.
 */
const rfb = require('./rfb');

/** How long a client message is, from its first bytes: a number, null while more is needed, -1 for one not known. */
function length(b) {
  if (b.length < 1) return null;
  const need = (n, f) => (b.length < n ? null : f());
  switch (b[0]) {
    case 0: return 20;                                              // SetPixelFormat
    case 2: return need(4, () => 4 + 4 * b.readUInt16BE(2));        // SetEncodings
    case 3: return 10;                                              // FramebufferUpdateRequest
    case 4: return 8;                                               // KeyEvent
    case 5: return 6;                                               // PointerEvent
    case 6: return need(8, () => 8 + Math.abs(b.readInt32BE(4)));   // ClientCutText (negative: the extended form)
    case 150: return 10;                                            // EnableContinuousUpdates
    case 248: return need(9, () => 9 + b[8]);                       // Fence
    case 250: return 4;                                             // xvp: shut down, reboot, reset
    case 251: return need(8, () => 8 + 16 * b[6]);                  // SetDesktopSize
    case 255: return need(2, () => (b[1] === 0 ? 12 : -1));         // QEMU's extended key event
    default: return -1;
  }
}
const WATCH_DROPS = new Set([4, 5, 6, 250, 251, 255]);

/** For a watching socket: ClientInit, then whole messages, without the ones that would act. Throws on one not known. */
function watchOnly() {
  let buf = Buffer.alloc(0), inited = false;
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    const out = [];
    if (!inited && buf.length) { out.push(buf.subarray(0, 1)); buf = buf.subarray(1); inited = true; }
    for (;;) {
      const n = inited ? length(buf) : null;
      if (n === null || buf.length < n) break;
      if (n < 0) throw new Error(`a message DOCA does not know (type ${buf[0]})`);
      if (!WATCH_DROPS.has(buf[0])) out.push(buf.subarray(0, n));
      buf = buf.subarray(n);
    }
    return Buffer.concat(out);
  };
}

/** The browser's side of the handshake: RFB 3.8 (3.3 and 3.7 answered too) with security None. */
function serverSide(ws, onDone) {
  let buf = Buffer.alloc(0), stage = 'version', minor = 8;
  ws.send(Buffer.from('RFB 003.008\n', 'latin1'));
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === 'version' && buf.length >= 12) {
      const m = /^RFB 003\.00(\d)\n$/.exec(buf.subarray(0, 12).toString('latin1'));
      buf = buf.subarray(12);
      minor = m ? Number(m[1]) : 8;
      if (minor < 7) { ws.send(Buffer.from([0, 0, 0, 1])); stage = 'done'; }   // 3.3: the server names the type
      else { ws.send(Buffer.from([1, 1])); stage = 'type'; }
    }
    if (stage === 'type' && buf.length >= 1) {
      buf = buf.subarray(1);
      if (minor >= 8) ws.send(Buffer.from([0, 0, 0, 0]));   // SecurityResult: in
      stage = 'done';
    }
    if (stage === 'done') { stage = 'piped'; onDone(buf); }
  };
}

async function upgrade(req, socket, head) {
  const m = /^\/ws\/vnc\/([\w-]+)/.exec(req.url);
  const target = m && require('./store').connection(m[1]);
  if (!target) return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  const drive = /[?&]drive=1\b/.test(req.url);
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true, handleProtocols: p => (p.has('binary') ? 'binary' : [...p][0] || false) });
  wss.handleUpgrade(req, socket, head, async ws => {
    const pending = [];
    ws.on('message', d => pending.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    const done = require('./state').opened(target.id, drive);
    ws.on('close', done);
    let up;
    try { up = await rfb.open(target); }
    catch (e) { done(); try { ws.close(1011, String(e.message).slice(0, 120)); } catch { /* closed */ } return; }
    if (ws.readyState !== 1) { up.sock.destroy(); return; }
    const sock = up.sock;
    up.r.detach();   // the server waits for ClientInit: nothing of its own is pending
    const close = () => { try { ws.close(); } catch { /* closed */ } sock.destroy(); };
    sock.on('data', d => { if (ws.readyState === 1) ws.send(d); });
    sock.on('close', close); sock.on('error', close);
    ws.on('close', () => sock.destroy()); ws.on('error', close);
    const pass = drive ? b => b : watchOnly();
    const toServer = b => { try { const out = pass(b); if (out.length) sock.write(out); } catch { close(); } };
    let handler = serverSide(ws, rest => { handler = toServer; if (rest.length) toServer(rest); });
    ws.removeAllListeners('message');
    ws.on('message', d => handler(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    for (const d of pending.splice(0)) handler(d);
  });
}

module.exports = { upgrade, length, watchOnly };

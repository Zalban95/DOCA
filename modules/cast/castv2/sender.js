'use strict';

/**
 * A Cast v2 sender (cast-reach.md §3.1): one TLS connection to a Cast device's port 8009 (its certificate is not
 * checked — no sender does; it is the device's own), the virtual connection to the receiver, PONG for every PING and a
 * PING every 5 s, requests matched to their answers by requestId. Used by cast/things.js; nothing here knows DOCA.
 *
 *   const s = await connect({ host, port })
 *   await s.status()                         RECEIVER_STATUS: volume, applications
 *   const app = await s.launch(appId)        launches (or finds) an app and connects to its transport
 *   await s.request(app.transportId, NS.media, { type: 'LOAD', … })
 *   s.send(app.transportId, NS.dashcast, { url, force: true })   (DashCast answers nothing)
 *   await s.stop(app.sessionId) · await s.volume(0.4) · s.close()
 */
const tls = require('tls');
const { encode, reader, NS } = require('./wire');

const SENDER = 'sender-doca';
const bad = (m, status = 502) => Object.assign(new Error(m), { status });

function connect({ host, port = 8009, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, timeout: timeoutMs });
    let rid = 1, beat = null, closed = false;
    const waiting = new Map();   // requestId -> {resolve, reject, timer}
    const listeners = new Set();
    const send = (destination, namespace, payload) => { if (!closed) sock.write(encode(SENDER, destination, namespace, payload)); };
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(beat);
      for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(bad('The Cast device closed the connection.')); }
      waiting.clear();
      // Ended, not destroyed: a message just written (DashCast's, which answers nothing) still goes out first.
      sock.end();
      setTimeout(() => sock.destroy(), 2000).unref();
    };
    sock.on('data', reader(m => {
      if (m.namespace === NS.heartbeat && m.data?.type === 'PING') return send(m.source, NS.heartbeat, { type: 'PONG' });
      const id = m.data?.requestId;
      if (id && waiting.has(id)) { const w = waiting.get(id); waiting.delete(id); clearTimeout(w.timer); w.resolve(m); }
      for (const fn of listeners) fn(m);
    }));
    sock.on('error', e => { if (!closed) { close(); reject(bad(`Cannot reach the Cast device at ${host}:${port}: ${e.code || e.message}`)); } });
    sock.on('timeout', () => { if (!closed) { close(); reject(bad(`The Cast device at ${host}:${port} did not answer.`)); } });
    sock.on('close', close);
    sock.once('secureConnect', () => {
      sock.setTimeout(0);
      send('receiver-0', NS.connection, { type: 'CONNECT' });
      beat = setInterval(() => send('receiver-0', NS.heartbeat, { type: 'PING' }), 5000);
      const request = (destination, namespace, payload, ms = timeoutMs) => new Promise((res, rej) => {
        if (closed) return rej(bad('The Cast connection is closed.'));
        const requestId = rid++;
        waiting.set(requestId, { resolve: res, reject: rej, timer: setTimeout(() => { waiting.delete(requestId); rej(bad(`The Cast device did not answer ${payload.type}.`)); }, ms) });
        send(destination, namespace, { ...payload, requestId });
      });
      const s = {
        send, request, close, get closed() { return closed; },
        /** Every message as it arrives (a media status, a receiver status); returns a function that stops listening. */
        on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        async status() { return (await request('receiver-0', NS.receiver, { type: 'GET_STATUS' })).data?.status || {}; },
        async launch(appId) {
          const r = await request('receiver-0', NS.receiver, { type: 'LAUNCH', appId }, 20000);
          if (r.data?.type !== 'RECEIVER_STATUS') throw bad(`The Cast device would not start the app: ${r.data?.reason || r.data?.type || 'no reason given'}.`);
          const app = (r.data.status?.applications || []).find(a => a.appId === appId);
          if (!app) throw bad('The Cast device started something else.');
          send(app.transportId, NS.connection, { type: 'CONNECT' });
          return app;
        },
        async stop(sessionId) { return (await request('receiver-0', NS.receiver, { type: 'STOP', ...(sessionId ? { sessionId } : {}) })).data; },
        async volume(level) { return (await request('receiver-0', NS.receiver, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, Number(level) || 0)) } })).data; },
        async mute(muted) { return (await request('receiver-0', NS.receiver, { type: 'SET_VOLUME', volume: { muted: !!muted } })).data; },
      };
      resolve(s);
    });
  });
}

/** The Default Media Receiver and DashCast (a URL-loading receiver, cast-reach.md §2.1). */
const APPS = { media: 'CC1AD845', dashcast: '84912283' };

module.exports = { connect, APPS, NS };

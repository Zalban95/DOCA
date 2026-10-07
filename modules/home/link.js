'use strict';

/**
 * One WebSocket to Home Assistant (its `/api/websocket` API): the hub signs in with the token kept as the key for
 * services `home-assistant`, then sends numbered commands and hears the events it subscribed to. HA's protocol:
 *   ← auth_required   → {type: 'auth', access_token}   ← auth_ok | auth_invalid {message}
 *   → {id, type, …}   ← {id, type: 'result', success, result | error}   ← {id, type: 'event', event} per subscription
 * The token goes to Home Assistant and nowhere else; an error carries HA's words, never the token.
 */
const WebSocket = require('ws');

const bad = (msg, status = 502) => Object.assign(new Error(msg), { status });
const CMD_MS = 15000;

/** The WebSocket address of an HA origin: http://ha:8123 → ws://ha:8123/api/websocket. */
function wsUrl(origin) {
  const u = new URL('/api/websocket', origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/**
 * Opens and signs in. Resolves with {cmd, close} once HA said auth_ok; rejects with HA's reason otherwise.
 * `onEvent(event)` hears every subscribed event; `onClose(reason)` once, when the socket ends after signing in.
 */
function open({ origin, token, onEvent = () => {}, onClose = () => {}, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl(origin), { handshakeTimeout: timeoutMs }); } catch (e) { return reject(bad(`Home Assistant at ${origin}: ${e.message}`)); }
    let seq = 0, ready = false, ended = false;
    const pending = new Map();   // id → {resolve, reject, timer}
    const fail = e => { if (!ready) { ready = true; reject(e); try { ws.terminate(); } catch { /* gone */ } } };
    const timer = setTimeout(() => fail(bad(`Home Assistant at ${origin} did not answer in ${Math.round(timeoutMs / 1000)} s.`, 504)), timeoutMs);

    const send = o => ws.send(JSON.stringify(o));
    const cmd = (type, extra = {}) => new Promise((ok, no) => {
      if (ended) return no(bad('The connection to Home Assistant closed.'));
      const id = ++seq;
      const t = setTimeout(() => { pending.delete(id); no(bad(`Home Assistant did not answer ${type} in ${CMD_MS / 1000} s.`, 504)); }, CMD_MS);
      pending.set(id, { resolve: ok, reject: no, timer: t });
      try { send({ id, type, ...extra }); } catch (e) { clearTimeout(t); pending.delete(id); no(bad(e.message)); }
    });
    const close = () => { ended = true; try { ws.close(); } catch { /* gone */ } };

    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type === 'auth_required') return send({ type: 'auth', access_token: token });
      if (m.type === 'auth_ok') { clearTimeout(timer); ready = true; return resolve({ cmd, close, version: m.ha_version || null }); }
      if (m.type === 'auth_invalid') {
        clearTimeout(timer);
        return fail(bad(`Home Assistant refused the token (${m.message || 'invalid'}) — paste a new long-lived token as the key home-assistant in Field → Connectors → Keys for services.`, 401));
      }
      if (m.type === 'event') { try { onEvent(m.event); } catch { /* a listener never breaks the link */ } return; }
      if (m.type === 'result' && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id); clearTimeout(p.timer);
        if (m.success) p.resolve(m.result);
        else p.reject(bad(`Home Assistant: ${m.error?.message || m.error?.code || 'refused'}`, 400));
      }
    });
    ws.on('error', e => fail(bad(`Home Assistant at ${origin}: ${e.code || e.message}`)));
    ws.on('close', () => {
      clearTimeout(timer);
      const was = ended;
      ended = true;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(bad('The connection to Home Assistant closed.')); }
      pending.clear();
      if (!ready) return fail(bad(`Home Assistant at ${origin} closed the connection before signing in.`));
      if (!was) try { onClose(); } catch { /* nothing to tell */ }
    });
  });
}

module.exports = { open, wsUrl };

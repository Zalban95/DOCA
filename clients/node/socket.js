'use strict';

/**
 * doca-client lending over a socket it opens to the hub (PROTOCOL.md §22.2) instead of a listener the hub dials: what a
 * home node does, so nothing in the household has to be reachable — no port forwarded, no tailnet needed, a hub on a
 * provider's server works the same. The hub sends JSON-RPC down the socket; `handle` answers each (doca-client.js
 * rpc). What the node pushes (a home's changes) goes up as notifications. A dropped socket is dialled again, waiting
 * longer each time up to a minute; a 401 is the hub revoking this machine, and ends it.
 */
const { connect } = require('./ws-lite');

const KEEPALIVE_MS = 25000;

/** Keeps the socket. Returns {stop, notify, connected()}; `onRevoked` once on a 401, `onState(up)` as it comes and goes. */
function dial(cfg, { handle, tls, signal, log = () => {}, onRevoked = () => {}, onState = () => {} }) {
  const url = `${cfg.hub.replace(/^http/, 'ws')}/api/v1/mcp/host`;
  let ws = null, stopped = false, wait = 1000, timer = null, alive = null, said = false;
  const stop = () => { stopped = true; clearTimeout(timer); clearInterval(alive); try { ws?.close(1000, 'stopped'); } catch { /* gone */ } };
  signal?.addEventListener('abort', stop, { once: true });

  async function once() {
    if (stopped) return;
    try {
      ws = await connect(url, { headers: { Authorization: `Bearer ${cfg.token}` }, tls });
    } catch (e) {
      if (e.status === 401) { stopped = true; return onRevoked(); }
      if (!said) { log(`… the hub is not answering (${e.message}); trying again, the wait growing to a minute.`); said = true; }
      return later();
    }
    if (stopped) return ws.close();
    wait = 1000; said = false;
    onState(true);
    alive = setInterval(() => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/keepalive' })), KEEPALIVE_MS);
    alive.unref?.();
    ws.on('message', async text => {
      let m; try { m = JSON.parse(text); } catch { return; }
      if (m.id === undefined || !m.method) return;   // a notification from the hub, or an answer to nothing
      const reply = await handle(m).catch(e => ({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: e.message } }));
      if (reply) try { ws.send(JSON.stringify(reply)); } catch { /* gone; the hub asks again */ }
    });
    ws.on('close', code => {
      clearInterval(alive); ws = null; onState(false);
      if (code === 4000) log('… another run of this machine connected to the hub and took over.');
      later();
    });
    ws.on('error', () => { /* close follows */ });
  }
  function later() {
    if (stopped) return;
    timer = setTimeout(once, wait);
    timer.unref?.();
    wait = Math.min(60000, wait * 2);
  }
  once();
  /** A push to the hub: a notification, dropped while the socket is down (the hub reads the whole state when it comes back). */
  const notify = (method, params) => { if (ws) try { ws.send(JSON.stringify({ jsonrpc: '2.0', method, params })); } catch { /* gone */ } };
  return { stop, notify, connected: () => !!ws };
}

module.exports = { dial };

'use strict';

/**
 * Where each VNC target stands, for the status column, Live and the agent's tools:
 *   connected    a person is watching or driving it through the hub now (proxy.js counts its sockets)
 *   reachable    something answered with an RFB greeting, asked at most every PROBE_MS and kept
 *   unreachable  nothing did
 * and who is at its keyboard: while a take-over socket (`?drive=1`) is open the agent's vnc_input waits, and its first
 * call after the hand-back says so — the agents' computers' rule (computers/vnc.js, takeover.js).
 */
const PROBE_MS = 30000;
const _probes = new Map();   // id → { at, addr, version, pending }
const _socks = new Map();    // id → { watching, driving }
const _handedBack = new Map();   // id → when the last driver left

const addrOf = t => `${t.host}:${t.port}`;

/** The RFB version the target greets with, or null — from a probe at most PROBE_MS old; one probe at a time each. */
async function probe(t, { fresh = false } = {}) {
  const hit = _probes.get(t.id);
  if (hit?.pending) return hit.pending;
  if (!fresh && hit && hit.addr === addrOf(t) && Date.now() - hit.at < PROBE_MS) return hit.version;
  const pending = require('./rfb').greets(t.host, t.port).then(version => { _probes.set(t.id, { at: Date.now(), addr: addrOf(t), version }); return version; });
  _probes.set(t.id, { ...(hit || {}), pending });
  return pending;
}

/** A socket of the console bridge opened: counted until it closes. Returns the close. */
function opened(id, drive) {
  const s = _socks.get(id) || { watching: 0, driving: 0 };
  s[drive ? 'driving' : 'watching']++;
  _socks.set(id, s);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    s[drive ? 'driving' : 'watching']--;
    if (drive && !s.driving) _handedBack.set(id, new Date().toISOString());
    if (!s.watching && !s.driving) _socks.delete(id);
  };
}

const connected = id => !!_socks.get(id);
const driving = id => (_socks.get(id)?.driving || 0) > 0;
const sockets = id => ({ watching: 0, driving: 0, ...(_socks.get(id) || {}) });   // who is on it now (machines/use.js)
const handedBack = id => _handedBack.get(id) || null;
const clearHandBack = id => _handedBack.delete(id);

/** connected, reachable or unreachable. */
async function stateOf(t) {
  if (connected(t.id)) return 'connected';
  return (await probe(t)) ? 'reachable' : 'unreachable';
}

module.exports = { probe, opened, connected, driving, sockets, handedBack, clearHandBack, stateOf, PROBE_MS, _reset: () => { _probes.clear(); _socks.clear(); _handedBack.clear(); } };

'use strict';

/**
 * A revoked device keeps nothing it was given: its event stream closes and it stops lending tools (self-test
 * 2026-10-08, #2).
 *
 * The hub's connection to a device's MCP server is to the device's own address with the bearer secret the device
 * offered, not with its device token — so revoking the token used to leave the server running and its tools in every
 * turn. Revoking now takes them with it: every server whose origin is that device is stopped and its definition
 * removed (pairing again offers afresh, and a person accepts again), and a pending offer from it is declined.
 * `tools.available()` also skips a revoked device's servers, so nothing is offered in the moment between.
 *
 * Revoking is announced by `api-v1/devices.js` whichever route did it; `watch()` also sweeps once, for a device
 * revoked while the hub was down.
 */
const devices = require('./api-v1/devices');

function drop(deviceId, why = 'the device was revoked') {
  // Its open event stream: the token no longer opens one, so the client's next try is a 401 and it stops lending
  // (clients/node). The /api/v1 route did this already; the panel's Revoke and the CLI did not.
  try { require('./api-v1/bus').dropDevice(deviceId, 'revoked'); } catch { /* no stream */ }
  const registry = require('./mcp/registry');
  const gone = [];
  for (const spec of registry.load().filter(s => s.origin?.kind === 'client' && s.origin.deviceId === deviceId)) {
    try { registry.remove(spec.id); gone.push(spec.id); } catch { /* already gone */ }
  }
  const offers = require('./mcp/offers');
  for (const o of offers.list().pending.filter(x => x.deviceId === deviceId)) {
    try { offers.reject(o.id, why); } catch { /* decided meanwhile */ }
  }
  if (gone.length) {
    const name = devices.get(deviceId)?.name || deviceId;
    require('./activity').note({ from: 'mcp', what: `stopped and removed ${gone.join(', ')}, hosted by ${name}`, why });
  }
  return gone;
}

let _watching = false;
function watch() {
  if (_watching) return;
  _watching = true;
  devices.events.on('revoked', id => { try { drop(id); } catch { /* never breaks a revoke */ } });
  try {
    for (const spec of require('./mcp/registry').load()) {
      const d = spec.origin?.kind === 'client' ? devices.get(spec.origin.deviceId) : null;
      if (d?.revokedAt) drop(d.id);
    }
  } catch { /* nothing to sweep */ }
}

module.exports = { drop, watch };

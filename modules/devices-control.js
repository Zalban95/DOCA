'use strict';

/**
 * Devices as hands (docs/design/devices-as-hands.md): what a paired device lets
 * the harness do (its granted families), and the actions DOCA can take on it.
 *
 * Actions, sent as the durable push event `device.control` (PROTOCOL §11.4):
 *   refresh     report caps, grants and state again
 *   reconnect   drop and reopen the push stream — DOCA also closes the stream
 *               itself, so this works with a client that does not know the event
 *   ask         re-request a family's permission (or the phone's screen session)
 *   disconnect  close its sessions and stop its services until it is opened
 *               again — DOCA also ends its sign-in sessions and its stream
 *   revoke      take a family back from DOCA's side (the harness stops offering it)
 *   restore     undo a revoke
 * The device answers `POST /api/v1/devices/self/control/:id/ack` and reports its
 * grants with `PUT /api/v1/devices/self/grants`.
 *
 * Kept in `<DATA_DIR>/device-control.json`: { [deviceId]: { grants, revoked,
 * disconnectedAt, grantsAt, history: [last 20 actions] } }.
 */
const crypto = require('crypto');
const store = require('./store');

const FAMILIES = ['files', 'shell', 'processes', 'screen', 'input', 'apps', 'device', 'elevated', 'mcp'];
const ACTIONS = ['refresh', 'reconnect', 'ask', 'disconnect', 'revoke', 'restore'];
const DOC = 'device-control';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

const load = () => store.readJson(DOC, {});
const save = doc => store.writeJson(DOC, doc);
const blank = () => ({ grants: {}, revoked: [], disconnectedAt: null, grantsAt: null, history: [] });

/** What DOCA knows of a device: grants as reported, families revoked here, whether it is disconnected, recent actions. */
function state(deviceId) {
  const s = { ...blank(), ...(load()[deviceId] || {}) };
  const d = require('./api-v1/devices').get(deviceId);
  const seen = d?.lastSeenAt ? Date.parse(d.lastSeenAt) : 0;
  const usable = FAMILIES.filter(f => s.grants[f] === true && !s.revoked.includes(f));
  return { deviceId, ...s, disconnected: !!s.disconnectedAt && Date.parse(s.disconnectedAt) >= seen, usable, families: FAMILIES };
}

/** Send an action to a device. `by` is who asked (a user id). */
function send(deviceId, action, { family = null, by = null } = {}) {
  const devices = require('./api-v1/devices');
  const d = devices.get(deviceId);
  if (!d || d.revokedAt) throw bad('No such paired device.', 404);
  if (!ACTIONS.includes(action)) throw bad(`action is one of: ${ACTIONS.join(', ')}.`);
  if (['ask', 'revoke', 'restore'].includes(action) && !FAMILIES.includes(family)) throw bad(`${action} needs a family: ${FAMILIES.join(', ')}.`);
  const doc = load();
  const s = { ...blank(), ...(doc[deviceId] || {}) };
  const id = `dc_${crypto.randomBytes(5).toString('hex')}`;
  const at = new Date().toISOString();
  if (action === 'revoke') s.revoked = [...new Set([...s.revoked, family])];
  if (action === 'restore') s.revoked = s.revoked.filter(f => f !== family);
  if (action === 'disconnect') s.disconnectedAt = at;
  s.history = [{ id, action, family, at, by, ackAt: null, ok: null, detail: null }, ...s.history].slice(0, 20);
  doc[deviceId] = s;
  save(doc);

  const bus = require('./api-v1/bus');
  bus.publish(deviceId, 'device.control', { id, action, family }, { durable: true });
  // What DOCA can do itself, so the action holds even for a client that does not know the event yet.
  if (action === 'disconnect') endSessions(deviceId);
  if (action === 'reconnect' || action === 'disconnect') setTimeout(() => bus.closeStreams(deviceId, action), 300).unref?.();
  return state(deviceId);
}

/** The device's sign-in sessions in the panel end with a disconnect (its token stays: it is not unpaired). */
function endSessions(deviceId) {
  try { require('./auth/store').deleteSessionsOfDevice(deviceId); } catch { /* nothing to end */ }
}

/** The device's answer to an action. */
function ack(deviceId, controlId, { ok = true, detail = '' } = {}) {
  const doc = load();
  const s = doc[deviceId];
  const h = s?.history?.find(x => x.id === controlId);
  if (!h) throw bad('No such action for this device.', 404);
  Object.assign(h, { ackAt: new Date().toISOString(), ok: ok !== false, detail: String(detail || '').slice(0, 300) });
  save(doc);
  return h;
}

/** The families the device has granted, as it reports them. Unknown names are ignored. */
function reportGrants(deviceId, grants = {}) {
  const doc = load();
  const s = { ...blank(), ...(doc[deviceId] || {}) };
  s.grants = Object.fromEntries(FAMILIES.filter(f => typeof grants[f] === 'boolean').map(f => [f, grants[f]]));
  s.grantsAt = new Date().toISOString();
  s.disconnectedAt = null;   // a device reporting is a device that is back
  doc[deviceId] = s;
  save(doc);
  return state(deviceId);
}

/** The device-side routes, on the /api/v1 router after its authentication. */
function mount(router) {
  router.post('/devices/self/control/:id/ack', (req, res) => {
    try { res.json({ control: ack(req.device.id, req.params.id, req.body || {}) }); }
    catch (e) { res.status(e.status || 500).json({ error: { code: e.status === 404 ? 'not_found' : 'bad_request', message: e.message } }); }
  });
  router.put('/devices/self/grants', (req, res) => {
    try {
      res.json(reportGrants(req.device.id, req.body?.grants || {}));
      require('./mcp/registry').wakeForDevice(req.device.id);   // a device reports its grants when it (re)connects
    }
    catch (e) { res.status(e.status || 500).json({ error: { code: 'bad_request', message: e.message } }); }
  });
}

/** Their OpenAPI entries, given openapi.js's own builders (so that file does not grow). */
function openapi({ obj, str, bool, arr, body, json, std }) {
  const grants = obj(Object.fromEntries(FAMILIES.map(f => [f, bool()])), { description: 'Each family: true granted on this device, false refused.' });
  return {
    '/devices/self/control/{id}/ack': { post: { tags: ['Devices'], summary: 'Answer a device.control action', operationId: 'ackDeviceControl',
      description: 'The device did (or refused) what a `device.control` event asked: refresh, reconnect, ask, disconnect, revoke, restore. docs/design/devices-as-hands.md.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: str() }],
      requestBody: body(obj({ ok: bool(), detail: str({ maxLength: 300 }) })), responses: { 200: json(obj({ control: obj({}, { additionalProperties: true }) })), ...std(400, 401, 404) } } },
    '/devices/self/grants': { put: { tags: ['Devices'], summary: 'Report which tool families this device has granted', operationId: 'putDeviceGrants',
      description: `Families: ${FAMILIES.join(', ')}. The harness is offered only a granted family that DOCA has not revoked. Reporting also clears a disconnect.`,
      requestBody: body(obj({ grants }, { required: ['grants'] })), responses: { 200: json(obj({ grants, usable: arr(str()) }, { additionalProperties: true })), ...std(400, 401) } } },
  };
}

module.exports = { FAMILIES, ACTIONS, state, send, ack, reportGrants, mount, openapi };

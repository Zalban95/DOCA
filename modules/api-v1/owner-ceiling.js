'use strict';

/**
 * A device never does more than its person may (owner, 2026-10-08, with members pairing their own devices).
 *
 * The phone preset carries `devices:admin` (a phone pairs its watch) and `command:*` (an admin's phone starts the
 * stack). A member's phone paired with it must not become the member's way past their level, so on every request
 * a device that belongs to a person is held to that person's rights:
 *   - without `host`, no hub commands: the request's scopes lose every `command:` scope (the stack, containers,
 *     services, the panel's restart are the machine — auth/reach.js keeps `hub_command` an admin's the same way),
 *     so /commands lists none, running one or confirming a prompt that runs one is refused, capabilities say so;
 *   - without `devices`, only the person's own devices: /devices lists theirs, and any route naming another
 *     person's device (or one of its jobs) answers 404, as a conversation does.
 * The stored scopes are not changed — an admin's later level change lifts the ceiling with no re-pairing. A device
 * with no person (a token minted on the host with `npm run token`) keeps what it holds, as before.
 */
const devices = require('./devices');
const { sendError } = require('./errors');

function ownerRole(device) {
  if (!device?.userId) return null;
  const store = require('../auth/store');
  return store.membership(device.orgId || store.defaultOrg()?.id, device.userId)?.role || 'none';
}

const holds = (device, right) => { const r = ownerRole(device); return r === null || require('../auth/rights').can(r, right); };

/** Whether this device reaches every device (no person, or a person holding the devices right). */
const managesAll = device => holds(device, 'devices');

/** Whether this device may act on `target`: itself, its person's own, or any when it manages all. */
const reaches = (device, target) => !target || target.id === device.id || managesAll(device) || (!!device.userId && target.userId === device.userId);

/** The device as this request sees it: its scopes without the hub's commands when its person lacks host. */
function narrow(device) {
  const held = device.scopes || [];
  if (!held.some(s => s === '*' || String(s).startsWith('command:')) || holds(device, 'host')) return device;
  const scopes = held.filter(s => s !== '*' && !String(s).startsWith('command:'));
  // '*' (the admin preset) held by a person without host: every family but the commands.
  if (held.includes('*')) scopes.push(...Object.keys(require('./scopes').FAMILIES).filter(f => f !== 'command').map(f => require('./scopes').normalize(f)));
  return { ...device, scopes };
}

/** Every `:id` on the router: another person's device, or a job of one, is not there for a device that manages its own. */
function param(req, res, next, id) {
  if (!req.device || managesAll(req.device)) return next();
  const job = String(id).startsWith('job_') ? require('./jobs').get(id) : null;
  const target = id === 'me' ? null : devices.get(job ? job.deviceId : id);
  if (target && !reaches(req.device, target)) return sendError(res, 404, 'not_found', job ? 'Unknown job' : 'Unknown device');
  next();
}

function mount(router) {
  router.param('id', param);
  // The registry, narrowed to the person's own before the route that would list everyone's.
  router.get('/devices', (req, res, next) => {
    const { hasScope, PRESETS, FAMILIES } = require('./scopes');
    if (!req.device || managesAll(req.device) || !hasScope(req.device.scopes, 'devices:admin')) return next();
    const bus = require('./bus');
    res.json({ devices: devices.list().filter(d => reaches(req.device, d)).map(d => ({ ...d, online: bus.isOnline(d.id), pending: bus.pendingCount(d.id) })),
      presets: PRESETS, scopeFamilies: FAMILIES });
  });
}

module.exports = { managesAll, reaches, narrow, mount, ownerRole };

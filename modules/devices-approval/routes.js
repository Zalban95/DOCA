'use strict';

/**
 * Deciding a new device, from the panel and from a device (index.js is the rule).
 *
 * The panel (rights.js: `chat`, narrowed here by the person's `approveDevices`):
 *   GET  /api/devices/pending          the waiting devices this person may decide
 *   POST /api/devices/:id/approve      Allow
 *   POST /api/devices/:id/refuse       Refuse: the device's token is revoked
 * A device (/api/v1, `interact`, as its person — the question it was asked is the usual way, this is the direct one):
 *   POST /api/v1/devices/{id}/approve  and  /refuse
 */
const approval = require('./index');
const who = require('../auth/approve-devices');

/** The person on a panel request, and their rung there: a sign-in from outside the tailnet approves only its own. */
function panelPerson(req) {
  const p = { id: req.auth?.user?.id || null, role: req.auth?.role || null };
  const rung = who.rungOf(p.role);
  return { p, rung: rung === 'anyone' && require('../network').limited(req, 'devices') ? 'own' : rung };
}

/** Whether this panel request may decide `d` (the device list draws Allow and Refuse only then). */
function mayDecide(req, d) {
  if (!require('../api-v1/devices').isPending(d) || d.revokedAt) return false;
  const { p, rung } = panelPerson(req);
  return who.mayApprove(p, d, rung);
}

function answer(res, fn) {
  try { res.json({ device: fn() }); }
  catch (e) { res.status(e.status || 500).json({ code: e.status === 403 ? 'forbidden' : e.status === 409 ? 'decided' : 'error', error: e.message }); }
}

function mount(app) {
  app.get('/api/devices/pending', (req, res) => {
    const { p, rung } = panelPerson(req);
    res.json({ devices: approval.pendingFor(p, rung), approves: rung });
  });
  for (const [verb, decision] of [['approve', 'allow'], ['refuse', 'refuse']]) {
    app.post(`/api/devices/:id/${verb}`, (req, res) => {
      const { p, rung } = panelPerson(req);
      answer(res, () => approval.decide(req.params.id, decision, p, { rung }));
    });
  }
}

function mountDevice(router) {
  const { requireScope } = require('../api-v1/auth');
  const { sendError } = require('../api-v1/errors');
  for (const [verb, decision] of [['approve', 'allow'], ['refuse', 'refuse']]) {
    router.post(`/devices/:id/${verb}`, requireScope('interact'), (req, res) => {
      const d = req.device;
      if (!d.userId) return sendError(res, 403, 'forbidden', 'Only a device of a person approves another: this one belongs to nobody.');
      const p = { id: d.userId, role: approval.roleOf(d.userId, d.orgId) };
      try { res.json({ device: approval.decide(req.params.id, decision, p, { via: d.id, viaName: d.name }) }); }
      catch (e) { sendError(res, e.status || 500, e.status === 403 ? 'forbidden' : e.status === 409 ? 'already_decided' : e.status === 404 ? 'not_found' : 'internal', e.message); }
    });
  }
}

/** POST /api/v1/devices (a device minting one directly): approved by this device's person when they may, else waiting. */
function createFromDevice(req, { name, scopes, caps, expiresAt, kind }) {
  const devices = require('../api-v1/devices');
  const owner = { userId: req.device.userId || null, orgId: req.device.orgId || null };
  const decided = approval.atStart({ kind: 'device', device: req.device }, { ...owner, scopes });
  const { scopes: capped, ...rest } = decided || {};
  const r = devices.create({ name, scopes: capped || scopes, caps, expiresAt, kind,
    approval: decided ? { ...rest, at: new Date().toISOString() } : { state: 'pending', askedAt: new Date().toISOString(), from: { network: `made by ${req.device.name}`, address: null } } });
  if (owner.userId) r.device = devices.update(r.device.id, owner);
  if (!decided) approval.ask(r.device.id);
  return r;
}

module.exports = { mount, mountDevice, createFromDevice, panelPerson, mayDecide };

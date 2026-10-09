'use strict';

/**
 * A new device waits until a person who may approve it says yes (the owner's decision of 2026-10-09, CONSTITUTION
 * S11). "Each new device has limited access until the admin or someone with the permission to approve a new device
 * accepts it … that device can have at most their own permissions … I don't want the login to be a burden."
 *
 *   at the start   whoever starts a pairing may already be its approver (`atStart`): an admin pairing from the panel
 *                  (any device, for anyone), or a person pairing from a device of theirs that is already approved
 *                  (a phone pairing its watch: the code goes device to device and is never on a screen). Then the
 *                  device is approved as it completes, with no question.
 *   otherwise      it is `pending` (api-v1/pending.js: its own record and its event stream, nothing else) and asked
 *                  (`ask`) where people already answer: the person's own approved devices that take questions, when
 *                  they may approve their own (reach.ask, one tap), and the open pages of everyone who may — a card
 *                  in the questions dock (live topic `device`) and Allow/Refuse in the device list. First answer wins;
 *                  unanswered, it stays pending: nothing approves it by waiting.
 *   approving      keeps at most what the approver holds and what the device's person holds (owner-ceiling
 *                  `ceilingFor`): the approver's level is applied to the stored scopes as they decide, and says what it
 *                  dropped; the person's own is applied on every request (owner-ceiling `narrow`), so a later change
 *                  of their level reaches the device with no re-pairing — which is why a person approving their own
 *                  device stores the preset as it is. It tells the device (`device.approved`) and is written down —
 *                  the audit, and an activity line (Chronicle's source hub).
 *   refusing       tells the device (`device.refused`) and revokes its token.
 *
 * Who may approve is auth/approve-devices.js (a level's `approveDevices`: none, own, anyone).
 */
const devices = require('../api-v1/devices');
const who = require('../auth/approve-devices');

const _asking = new Map();   // device id -> AbortController of the question on the person's devices

const now = () => new Date().toISOString();
const store = () => require('../auth/store');

/** The role of `userId` in the device's organisation, or null. */
function roleOf(userId, orgId) {
  if (!userId) return null;
  return store().membership(orgId || store().defaultOrg()?.id, userId)?.role || 'none';
}

const nameOf = userId => { const u = userId && store().userById(userId); return u ? (u.name || u.email || u.id) : null; };

/**
 * Scopes held to the approver's level as they decide: [kept, dropped]. The device's person's level is not stored —
 * owner-ceiling `narrow` applies it on every request — so an approver deciding their own device keeps them as they are.
 */
function capped(scopes, approver, personId) {
  if (!approver?.id || approver.id === personId) return [[...(scopes || [])], []];
  const kept = require('../api-v1/owner-ceiling').ceilingFor(scopes, approver.role);
  return [kept, (scopes || []).filter(s => !kept.includes(s))];
}

/**
 * Whether whoever starts a pairing approves the device it makes: an approval to carry into the pairing
 * ({ state: 'approved', by, via, scopes, dropped }), or null (the device will wait).
 *   starter { kind: 'panel', person: { id, role }, limited } — a signed-in page; `limited`: from outside the tailnet
 *           { kind: 'device', device }                       — an approved device (/api/v1 pair/start, POST /devices)
 *           { kind: 'person', person }                       — a person's link code (a chat)
 *           { kind: 'host' }                                 — the host's own CLI
 * `userId`: whose the new device is.
 */
function atStart(starter, { userId = null, orgId = null, scopes = [] } = {}) {
  const decided = (by, role, via) => {
    const [kept, dropped] = capped(scopes, { id: by, role }, userId);
    return { state: 'approved', by: by ? { userId: by, name: nameOf(by) } : null, via, scopes: kept, ...(dropped.length ? { dropped } : {}) };
  };
  if (!starter || starter.kind === 'host') return decided(null, null, 'host');
  if (starter.kind === 'device') {
    const d = starter.device;
    if (!d?.userId) return userId ? null : decided(null, null, d?.id || 'device');   // a device of the hive's makes the hive's
    const role = roleOf(d.userId, d.orgId);
    return who.mayApprove({ id: d.userId, role }, { userId }) ? decided(d.userId, role, d.id) : null;
  }
  const p = starter.person;
  if (!p?.id) return null;
  // From the panel or a link code, only an approver of any device decides at the start (an admin pairing for
  // someone); a person approving their own taps Allow once the device has shown up, so they see which one it was.
  const rung = starter.limited ? 'own' : who.rungOf(p.role);
  return rung === 'anyone' ? decided(p.id, p.role, 'panel') : null;
}

/** What a person deciding is shown: name, kind, model, whose, where it paired from, what it would hold. */
function view(d) {
  const ext = d.caps?.ext || {};
  return { id: d.id, name: d.name, kind: d.kind, formFactor: d.caps?.formFactor || 'other',
    model: [ext.manufacturer, ext.model].filter(Boolean).join(' ') || ext.client || null,
    person: d.userId ? { id: d.userId, name: nameOf(d.userId) } : null,
    from: d.approval?.from || null, scopes: d.scopes || [], askedAt: d.approval?.askedAt || null,
    askedOf: d.approval?.askedOf || [] };
}

/** "a phone", "a watch", "a linked chat" — how the question names it. */
function kindWord(d) {
  if (d.kind === 'channel') return 'linked chat';
  if (d.caps?.ext?.client === 'doca-browser') return 'browser extension';
  return { phone: 'phone', watch: 'watch', desktop: 'computer', tablet: 'tablet', headless: 'device' }[d.caps?.formFactor] || 'device';
}

/** One line: "Pixel 8 (phone, Google Pixel 8) for Mia, paired from the local network (192.168.1.40)". */
function describe(d) {
  const v = view(d);
  const where = v.from ? `, paired from ${v.from.network}${v.from.address ? ` (${v.from.address})` : ''}` : '';
  return `${v.name} (${kindWord(d)}${v.model ? `, ${v.model}` : ''})${v.person ? ` for ${v.person.name}` : ''}${where}. It would hold: ${v.scopes.join(' ') || 'nothing'}.`;
}

/** The person's own devices that take a question and are approved — never the one waiting. */
function trustedOf(personId, exceptId) {
  const { hasScope } = require('../api-v1/scopes');
  return devices.list().filter(d => d.userId === personId && d.id !== exceptId && !d.revokedAt && !devices.isPending(d)
    && !['agent', 'browser'].includes(d.kind) && hasScope(d.scopes, 'interact'));
}

/** A device has just become pending: record who is asked, and ask them. */
function ask(id) {
  const d = devices.get(id);
  if (!devices.isPending(d)) return;
  const approvers = who.approversOf(d);
  const askedOf = approvers.map(a => ({ id: a.id, name: a.name, own: a.own }));
  devices.update(id, { approval: { ...d.approval, askedOf } });
  const rec = devices.get(id);
  require('../live').changed('device', id, 'pending', { personId: d.userId || null, device: view(rec) });
  try {
    require('../activity').note({ from: 'devices', what: `${rec.name} waits for approval`, why: `asked of ${who.sayWho(approvers)}`,
      person: rec.userId ? { id: rec.userId, name: nameOf(rec.userId) } : null });
  } catch { /* never breaks pairing */ }
  if (!approvers.some(a => a.own)) return;
  const mine = trustedOf(rec.userId, id);
  if (!mine.length) return;
  const ctrl = new AbortController();
  _asking.set(id, ctrl);
  const reach = require('../harness/reach');
  reach.ask({ to: mine.map(x => x.id), question: `Your new ${kindWord(rec)} — allow it?`, note: describe(rec),
    choices: [{ id: 'allow', label: 'Allow' }, { id: 'refuse', label: 'Refuse' }], timeoutSec: reach.ASK_MAX_SEC, signal: ctrl.signal, panel: false })
    .then(r => {
      const by = r?.status === 'answered' && mine.find(x => x.id === r.device?.id);
      if (!by || !devices.isPending(devices.get(id))) return;
      decide(id, r.choiceId === 'allow' ? 'allow' : 'refuse', { id: by.userId, role: roleOf(by.userId, by.orgId) }, { via: by.id, viaName: by.name });
    })
    .catch(() => { /* none takes questions now: the panel still has it */ })
    .finally(() => { if (_asking.get(id) === ctrl) _asking.delete(id); });
}

/**
 * Allow or refuse a pending device as `approver` ({ id, role }; `rung` when the request narrows it). `via`: the
 * device it was answered from, or 'panel'. Throws { status } with a sentence when it may not.
 */
function decide(id, decision, approver, { via = 'panel', viaName = null, rung } = {}) {
  const d = devices.get(id);
  if (!d || d.revokedAt) throw Object.assign(new Error('There is no such device waiting.'), { status: 404 });
  if (!devices.isPending(d)) throw Object.assign(new Error(`${d.name} was already ${d.approval?.state || 'approved'}.`), { status: 409 });
  if (!who.mayApprove(approver, d, rung)) {
    throw Object.assign(new Error(`You may not approve ${d.name}: ${d.userId === approver?.id ? 'your level approves no device, not even your own' : 'it is someone else\'s and your level approves only your own'}. It was asked of ${who.sayWho(who.approversOf(d))}.`), { status: 403 });
  }
  const allow = decision === 'allow';
  const by = { userId: approver.id, name: nameOf(approver.id) };
  const base = { askedAt: d.approval.askedAt, from: d.approval.from || null, by, via, at: now() };
  let next;
  if (allow) {
    const [kept, dropped] = capped(d.scopes, approver, d.userId);
    next = devices.update(id, { scopes: kept, approval: { state: 'approved', ...base, ...(dropped.length ? { dropped } : {}) } });
    require('../api-v1/bus').publish(id, 'device.approved', { by: by.name, at: base.at, scopes: kept, dropped });
  } else {
    next = devices.update(id, { approval: { state: 'refused', ...base } });
    const bus = require('../api-v1/bus');
    bus.publish(id, 'device.refused', { by: by.name, at: base.at });
    devices.revoke(id);
    bus.dropDevice(id, 'refused');
  }
  _asking.get(id)?.abort();
  _asking.delete(id);
  const what = `${d.name} ${allow ? 'approved' : 'refused'} by ${by.name}${viaName ? ` from ${viaName}` : ' at the panel'}`;
  try {
    store().audit({ orgId: d.orgId || store().defaultOrg()?.id, actorId: approver.id, subjectId: d.userId || null, via: via === 'panel' ? null : via,
      action: allow ? 'device approved' : 'device refused', detail: `${d.id} (${d.name})${allow && next.approval.dropped ? ` without ${next.approval.dropped.join(', ')}` : ''}` });
  } catch { /* the audit never breaks the decision */ }
  try { require('../activity').note({ from: 'devices', what, why: describe(d), person: d.userId ? { id: d.userId, name: nameOf(d.userId) } : null }); } catch { /* nor the line */ }
  require('../live').changed('device', id, 'decided', { personId: d.userId || null, state: next.approval.state });
  return next;
}

/** The pending devices `person` ({ id, role }) may decide, oldest first. */
function pendingFor(person, rung) {
  return devices.list().filter(d => !d.revokedAt && devices.isPending(d) && who.mayApprove(person, d, rung))
    .sort((a, b) => String(a.approval.askedAt).localeCompare(String(b.approval.askedAt))).map(view);
}

/** Whether a page of `person` hears a change on the live topic `device`: they may decide it. */
function hears(person, change) {
  if (!person?.id) return false;
  const rung = who.rungOf(person.role);
  return rung === 'anyone' || (rung === 'own' && !!change.personId && change.personId === person.id);
}

/** What a device reads about its own approval (GET /api/v1/devices/me): its state, and while pending who was asked. */
function selfView(d) {
  const a = d?.approval;
  if (!a) return { state: 'approved' };
  if (a.state !== 'pending') return { state: a.state, at: a.at || null, by: a.by?.name || null, dropped: a.dropped || [] };
  const asked = a.askedOf || who.approversOf(d);
  return { state: 'pending', askedAt: a.askedAt, askedOf: asked.map(x => x.name), message: `Waiting for approval by ${who.sayWho(asked)}.` };
}

/** "the local network" … for where a device paired from (shown to whoever approves it). */
function networkOf(address) {
  const listen = require('../listen');
  const a = String(address || '');
  return { address: a.replace(/^::ffff:/, '') || null,
    network: listen.isLoopback(a) ? 'this machine' : listen.isTailnet(a) ? 'the tailnet' : listen.isPrivate(a) ? 'the local network' : 'the internet' };
}

/** Withdraw every question still waiting on a device (tests). */
function _reset() { for (const c of _asking.values()) c.abort(); _asking.clear(); }

module.exports = { _reset, atStart, ask, decide, pendingFor, hears, view, selfView, describe, networkOf, trustedOf, roleOf };

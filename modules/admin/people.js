'use strict';

/**
 * Hub → Admin, People and devices: how many people at each level, how many were here in the last day, and the paired
 * devices by kind (a device of kind `device` by the form factor it paired with), with the archived, waiting and
 * unowned counted. From auth/store.js (accounts, memberships, sessions) and api-v1/devices.js — numbers and level
 * names only.
 */
const { plural, line, DAY } = require('./words');

// [one, many]: a count reads "1 phone · 2 watches".
const FORMS = { phone: ['phone', 'phones'], watch: ['watch', 'watches'], desktop: ['desktop', 'desktops'], tablet: ['tablet', 'tablets'], car: ['car', 'cars'],
  glasses: ['pair of glasses', 'pairs of glasses'], browser: ['browser client', 'browser clients'], headless: ['headless device', 'headless devices'] };
const KINDS = { browser: ['browser', 'browsers'], agent: ['agent', 'agents'], channel: ['linked chat', 'linked chats'] };
const OTHER = ['other device', 'other devices'];

function read(now = Date.now()) {
  const store = require('../auth/store'), levels = require('../auth/levels');
  const org = store.defaultOrg();
  const people = store.listUsers().map(u => {
    const m = org ? store.membership(org.id, u.id) : null;
    let seen = null;
    try { seen = store.sessionsOf(u.id).map(s => s.lastSeenAt).filter(Boolean).sort().pop() || null; } catch { /* none */ }
    return { level: m?.role || null, levelName: (m?.role && levels.get(m.role)?.name) || m?.role || 'no level', suspended: !!u.suspendedAt, pending: m?.status === 'pending', seen };
  });
  const devices = require('../api-v1/devices');
  const list = devices.list().filter(d => !d.revokedAt).map(d => ({ kind: d.kind, form: d.caps?.formFactor || null,
    archived: !!d.archivedAt, pending: devices.isPending(d), unowned: !d.userId }));
  return { people, devices: list, since: new Date(now - DAY).toISOString() };
}

function build(x) {
  const ppl = x.people || [];
  const active = ppl.filter(p => !p.suspended && !p.pending);
  const byLevel = new Map();
  for (const p of active) byLevel.set(p.levelName, (byLevel.get(p.levelName) || 0) + 1);
  const lines = [line('people', 'People', plural(active.length, 'person', 'people'), 'ok', 'settings/users',
    [...byLevel].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join(' · ') || null)];
  const seen = active.filter(p => p.seen && p.seen >= x.since).length;
  lines.push(line('active', 'Here in the last day', plural(seen, 'person', 'people'), 'ok', 'chronicle'));
  const susp = ppl.filter(p => p.suspended).length, waiting = ppl.filter(p => p.pending && !p.suspended).length;
  if (susp || waiting) lines.push(line('suspended', 'Not active', [susp ? `${susp} suspended` : '', waiting ? `${waiting} waiting for approval` : ''].filter(Boolean).join(' · '), waiting ? 'ask' : 'info', 'settings/users'));
  const dev = (x.devices || []).filter(d => !d.archived);
  const counts = new Map();
  for (const d of dev) {
    const k = d.kind === 'device' ? (FORMS[d.form] || OTHER) : (KINDS[d.kind] || OTHER);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  lines.push(line('devices', 'Devices', plural(dev.length, 'device'), 'ok', 'apikeys', [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, ...k)).join(' · ') || null));
  const archived = (x.devices || []).filter(d => d.archived).length, unowned = dev.filter(d => d.unowned).length, pending = dev.filter(d => d.pending).length;
  lines.push(line('devices-other', 'Put away · nobody\'s · waiting', `${archived} · ${unowned} · ${pending}`, unowned || pending ? 'ask' : 'ok', 'apikeys'));
  return { id: 'people', title: 'People and devices', lines };
}

module.exports = { read, build };

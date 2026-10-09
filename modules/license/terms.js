'use strict';

/**
 * What a verified licence says, read from Keygen's JSON:API payload (certificate.js opens it):
 *
 *   customer   metadata.customer, else the licence's name
 *   edition    metadata.edition, else its policy's name
 *   codes      the licence's entitlements (their `code`, lower case) — feature codes (codes.js), or `all`
 *   expiry     the licence's own expiry (null: does not expire); fileExpiry is when this file must be renewed
 *   machine    the fingerprint a machine file is bound to; a licence file binds to none and is accepted only when
 *              its metadata says `anyMachine: true` (a test's, or a deliberate site licence)
 *   seats, maxDevices, maxMachines   when the licence names them
 *   checkInDays   how often the hive must check in (metadata.checkInDays, else the policy's check-in interval)
 *   maxGraceDays  how long past a missed check-in or an expiry the vendor allows (metadata; 30 when unsaid)
 */
const DAY = 86400000;
const UNIT = { day: 1, week: 7, month: 30, year: 365 };

function terms(payload) {
  const data = payload?.data || {};
  const inc = Array.isArray(payload?.included) ? payload.included : [];
  const lic = data.type === 'licenses' ? data : inc.find(x => x.type === 'licenses') || {};
  const machine = data.type === 'machines' ? data : null;
  const a = lic.attributes || {};
  const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const policy = inc.find(x => x.type === 'policies')?.attributes || {};
  const product = inc.find(x => x.type === 'products')?.attributes || {};
  const codes = [...new Set(inc.filter(x => x.type === 'entitlements').map(x => String(x.attributes?.code || '').toLowerCase()).filter(Boolean))].sort();
  const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const policyDays = policy.requireCheckIn && policy.checkInInterval ? (UNIT[policy.checkInInterval] || 0) * (num(policy.checkInIntervalCount) || 1) : null;
  return {
    licenceId: lic.id || null,
    customer: String(meta.customer || a.name || '').slice(0, 200) || null,
    edition: String(meta.edition || policy.name || '').slice(0, 100) || null,
    product: product.name || null,
    status: a.status || null,
    codes,
    expiry: a.expiry || null,
    issued: payload?.meta?.issued || null,
    fileExpiry: payload?.meta?.expiry || null,
    machine: machine?.attributes?.fingerprint || null,
    anyMachine: meta.anyMachine === true,
    seats: num(meta.seats) ?? num(a.maxUsers),
    maxDevices: num(meta.maxDevices),
    maxMachines: num(a.maxMachines),
    checkInDays: num(meta.checkInDays) ?? policyDays,
    maxGraceDays: num(meta.maxGraceDays) ?? 30,
  };
}

/**
 * Whether a licence is good for this hive now, and when it lapses. `valid: false` (with `code` and `why`) means it
 * enables nothing; a valid one that has lapsed — past its expiry, its file's expiry or a check-in it missed — keeps
 * its features for the grace, then they are read-only (index.js readOnly), never removed.
 */
function judge(t, { fingerprint, now = Date.now(), lastCheckIn = null } = {}) {
  const bad = (code, why) => ({ valid: false, code, why });
  if (['SUSPENDED', 'BANNED'].includes(String(t.status).toUpperCase())) return bad('revoked', 'The licence was suspended or revoked by its issuer.');
  if (t.issued && Date.parse(t.issued) > now + DAY) return bad('clock', 'The licence was issued after this machine\'s clock says it is now: the clock is wrong, or was set back.');
  if (t.machine && t.machine !== fingerprint) return bad('wrong_machine', 'This licence is for another hive or another machine (its fingerprint differs from this hive\'s).');
  if (!t.machine && !t.anyMachine) return bad('unbound', 'This licence is not bound to a machine: ask for this hive\'s machine file (Settings → System → Licence shows its fingerprint).');
  const ends = [];
  if (t.expiry) ends.push({ at: Date.parse(t.expiry), why: 'the licence expired' });
  if (t.fileExpiry) ends.push({ at: Date.parse(t.fileExpiry), why: 'this licence file expired: check in, or upload a renewed one' });
  if (t.checkInDays) {
    const last = Math.max(lastCheckIn ? Date.parse(lastCheckIn) : 0, t.issued ? Date.parse(t.issued) : 0);
    if (last) ends.push({ at: last + t.checkInDays * DAY, why: `the hive has not checked in for ${t.checkInDays} days` });
  }
  const first = ends.filter(e => Number.isFinite(e.at)).sort((x, y) => x.at - y.at)[0] || null;
  return { valid: true, lapsesAt: first ? new Date(first.at).toISOString() : null, lapsedWhy: first?.why || null, lapsed: !!first && first.at <= now };
}

module.exports = { terms, judge, DAY };

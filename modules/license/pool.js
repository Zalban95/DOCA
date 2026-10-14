'use strict';

/**
 * Licences for test installs in agents' computers (asked 2026-10-14: "enable the demo licence for the computers the
 * agents use … 6 licences that can be used at the same time"). The owner keeps one licence with N seats — the
 * project's demo licence, or seats of a customer's own — and the hub hands a seat to a DOCA installed inside one of
 * its computers: it activates a machine for that inner hive's fingerprint with the pool's key, checks out a machine
 * file bound to it, verifies it here, and gives it back to be copied into the inner install (computers/licence.js).
 * The computer never calls the licence server and is never given the key on its own.
 *
 * At most `seats` are held at once. A computer removed or archived gives its seat back: the hub deactivates its
 * machine on the licence server (a seat it could not free yet stays counted, marked, and is tried again).
 *
 * Kept in keys/licence-pool.json (the protected keys folder: the agents' file tools cannot read it, a backup carries
 * it); view() is all that leaves this module — never the key.
 *
 * The trade-off, said where it is decided: Keygen puts the licence, its key included, inside every machine file it
 * signs — plain or encrypted (encrypted, the key is what opens it). So the file in a test computer carries the pool's
 * key, and an agent working in that computer could read it out of the file. Use a licence made for test computers
 * only — never the hive's own — with no more seats than you want in use: the server never lets it hold more.
 */
const files = require('./files');

const FILE = 'licence-pool.json';
const INCLUDE = 'license,license.entitlements,license.policy,license.product';   // what the inner hive reads (terms.js)
const bad = (code, message, status = 409) => Object.assign(new Error(message), { code, status, pool: true });

const read = () => files.readJson(FILE, {});
const write = v => files.writeJson(FILE, v);
const holders = p => (Array.isArray(p.holders) ? p.holders : []);

function base(p) {
  const server = String(p.server || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) return null;
  return `${server}/v1${p.account ? `/accounts/${encodeURIComponent(p.account)}` : ''}`;
}

/** What the panel shows: whether one is set, where it checks in, the seats and who holds them. Never the key. */
function view() {
  const p = read();
  return { set: !!p.key, server: p.server || '', account: p.account || '', seats: p.seats || 0,
    inUse: holders(p).map(h => ({ computer: h.computer, name: h.name, at: h.at, fileExpiry: h.fileExpiry || null, codes: h.codes || [],
      ...(h.releasing ? { releasing: { at: h.releasing.at, why: h.releasing.why } } : {}) })) };
}

/** Set or change the pool: a key (omitted or '' keeps the one kept), the server's address, its account, the seats. */
function set({ key, server, account, seats } = {}) {
  const p = read();
  const next = { ...p };
  if (typeof server === 'string') {
    if (server.trim() && !/^https?:\/\/[^\s]+$/i.test(server.trim())) throw bad('bad_server', 'The licence server is an address: https://…', 400);
    next.server = server.trim();
  }
  if (typeof account === 'string') next.account = account.trim();
  if (seats !== undefined) {
    const n = Number(seats);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw bad('bad_seats', 'Seats is a whole number from 1 to 100: how many test computers may hold a licence at once.', 400);
    next.seats = n;
  }
  if (typeof key === 'string' && key.trim()) next.key = key.trim();
  if (!next.key) throw bad('no_key', 'Paste the licence key for test computers.', 400);
  if (!base(next)) throw bad('bad_server', 'The licence server\'s address is needed: the hub activates each test computer\'s seat there.', 400);
  if (!next.seats) next.seats = 1;
  write({ ...next, holders: holders(next) });
  return view();
}

const NO_POOL = 'No licence for test computers is set: an admin adds one in Settings → System → Licence → Licence for test computers.';
/** Throws when no pool is set (the computer side asks before it reads anything in the computer). */
function ready() { if (!read().key) throw bad('no_pool', NO_POOL); }

let _chain = Promise.resolve();
/** One change to the seats at a time: two computers asking at once must not both take the last seat. */
const serial = fn => { const r = _chain.then(fn, fn); _chain = r.catch(() => {}); return r; };

/** Deactivate a holder's machine on the server; a machine already gone counts as freed. → null, or why not. */
async function deactivate(p, h) {
  const { call, detail } = require('./checkin');
  try {
    const r = await call('DELETE', `${base(p)}/machines/${encodeURIComponent(h.fingerprint)}`, { key: p.key });
    if (r.status < 300 || r.status === 404) return null;
    return detail(r);
  } catch (e) { return `the licence server could not be reached (${e.cause?.code || e.message})`; }
}

/** Free the seats still marked as being freed (a server that did not answer before). */
async function retry(p) {
  for (const h of holders(p).filter(x => x.releasing)) {
    const why = await deactivate(p, h);
    p.holders = why ? holders(p).map(x => (x === h ? { ...x, releasing: { at: new Date().toISOString(), why } } : x)) : holders(p).filter(x => x !== h);
    if (!why) note(`freed the test-computer licence seat ${h.name} held`, 'tried again: the licence server answers now');
  }
  write(p);
}

const holding = p => holders(p).map(h => `"${h.name}" (${h.computer}${h.releasing ? ', removed — its seat not freed yet' : ''})`).join(', ');

/**
 * A seat for a computer's inner hive: → {certificate, terms, seat: {used, of}}. Throws with `code`: no_pool,
 * seats_full, unreachable, pool_key, activation, checkout, or what the file's check said.
 */
function grant({ computer, name, fingerprint }) {
  return serial(async () => {
    let p = read();
    if (!p.key) throw bad('no_pool', NO_POOL);
    if (!/^[0-9a-f]{64}$/.test(String(fingerprint || ''))) throw bad('bad_fingerprint', 'A hive\'s fingerprint is 64 hex characters (its Settings → System → Licence shows it).', 400);
    if (holders(p).some(h => h.releasing)) { await retry(p); p = read(); }
    const mine = holders(p).find(h => h.computer === computer && !h.releasing);
    if (mine && mine.fingerprint !== fingerprint) {   // DOCA installed again in it: another hive, so the old machine goes
      const why = await deactivate(p, mine);
      p.holders = holders(p).map(h => (h === mine ? (why ? { ...h, computer: `${computer}:before`, releasing: { at: new Date().toISOString(), why } } : null) : h)).filter(Boolean);
      write(p);
    }
    const kept = holders(p).find(h => h.computer === computer && !h.releasing);
    if (!kept && holders(p).length >= p.seats) {
      throw bad('seats_full', `All ${p.seats} seat${p.seats === 1 ? '' : 's'} of the licence for test computers are in use: ${holding(p)}. Remove or archive one of those computers to free its seat, or raise the seats in Settings → System → Licence.`);
    }
    const { call, detail } = require('./checkin');
    const b = base(p);
    let activated = false;
    try {
      const validate = () => call('POST', `${b}/licenses/actions/validate-key`, { body: { meta: { key: p.key, scope: { fingerprint } } } });
      let v = await validate();
      if (!v.json?.data?.id) throw bad('pool_key', `The licence server did not accept the key for test computers: ${detail(v)}.`);
      if (!v.json.meta?.valid && ['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH'].includes(v.json.meta?.code)) {
        const a = await call('POST', `${b}/machines`, { key: p.key, body: { data: { type: 'machines', attributes: { fingerprint, name: `test computer ${name}`.slice(0, 100), platform: 'linux' },
          relationships: { license: { data: { type: 'licenses', id: v.json.data.id } } } } } });
        if (a.status >= 300) throw bad('activation', `The licence server would not activate a seat for "${name}": ${detail(a)}.`);
        activated = true;
        v = await validate();
      }
      if (!v.json?.meta?.valid) throw bad('pool_key', `The licence for test computers is not valid now: ${v.json?.meta?.detail || v.json?.meta?.code || detail(v)}.`);
      // Plain (base64+ed25519): the inner hive opens it with no key of its own (certificate.js).
      const out = await call('POST', `${b}/machines/${encodeURIComponent(fingerprint)}/actions/check-out?include=${INCLUDE}`, { key: p.key });
      const certificate = out.json?.data?.attributes?.certificate;
      if (!certificate) throw bad('checkout', `No licence file came back for "${name}": ${detail(out)}.`);
      const t = check(certificate, fingerprint);
      const h = { computer, name, fingerprint, at: kept?.at || new Date().toISOString(), renewedAt: new Date().toISOString(), fileExpiry: t.fileExpiry, codes: t.codes };
      p = read();
      p.holders = [...holders(p).filter(x => x.computer !== computer), h];
      write(p);
      note(`gave the test computer "${name}" a licence seat`, `${p.holders.length} of ${p.seats} in use`);
      return { certificate, terms: t, seat: { used: p.holders.length, of: p.seats } };
    } catch (e) {
      if (activated) await deactivate(p, { fingerprint });   // a seat taken for a file that never arrived goes back
      if (e.pool) throw e;
      throw bad('unreachable', `The licence server for test computers could not be reached (${e.cause?.code || e.message}). Nothing was changed.`, 502);
    }
  });
}

/** The file must verify here and be good for that fingerprint, or it is not handed on. → its terms */
function check(certificate, fingerprint) {
  const { terms, judge } = require('./terms');
  let t;
  try { t = terms(require('./certificate').read(certificate, require('./keys').VENDOR_KEYS, { fingerprint }).payload); }
  catch (e) { throw bad(e.code || 'unreadable', `The licence file for the test computer does not verify: ${e.message}`); }
  if (t.machine !== fingerprint) throw bad('wrong_machine', 'The licence server sent a file for another machine.');
  const j = judge(t, { fingerprint });
  if (!j.valid) throw bad(j.code, `The licence file for the test computer is not good: ${j.why}`);
  return t;
}

/** Give a computer's seat back (it was removed or archived, or asked). → {freed, why?} or null when it held none. */
function release(computer, { reason = 'the computer was removed' } = {}) {
  return serial(async () => {
    const p = read();
    const h = holders(p).find(x => x.computer === computer);
    if (!h || !p.key) return null;
    const why = await deactivate(p, h);
    p.holders = why ? holders(p).map(x => (x === h ? { ...x, releasing: { at: new Date().toISOString(), why } } : x)) : holders(p).filter(x => x !== h);
    write(p);
    note(why ? `could not free the licence seat of the test computer "${h.name}" yet` : `freed the licence seat of the test computer "${h.name}"`, why || reason);
    return why ? { freed: false, why } : { freed: true };
  });
}

/** Forget the pool: every seat freed first where the server answers; the rest are named, to free on the server. */
async function forget() {
  const p = read();
  const left = [];
  for (const h of holders(p)) { const r = await release(h.computer, { reason: 'the licence for test computers was removed' }); if (r && !r.freed) left.push(h.name); }
  files.remove(FILE);
  note('removed the licence for test computers', left.length ? `seats still active on the licence server: ${left.join(', ')}` : 'every seat freed');
  return { ok: true, left };
}

function note(what, why) { try { require('../activity').note({ from: 'licence', what, why }); } catch { /* a record, never in the way */ } }

module.exports = { view, set, ready, grant, release, forget, FILE };

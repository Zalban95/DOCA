'use strict';

/**
 * Checking in with the licence server (Keygen's API, https://keygen.sh/docs/api/): with the licence key and this
 * hive's fingerprint it validates the key, activates this machine the first time (so the licence names it), and
 * checks out a fresh machine file — the signed licence, bound to this fingerprint, encrypted with the key — which
 * replaces keys/licence.lic only once it verifies here against the vendor keys. Nothing the server says is trusted
 * unsigned: a valid answer only moves the check-in date; entitlements come from the signed file alone.
 *
 * `licence.server` empty means offline: the hive is renewed by uploading a file (routes.js). A suspended or revoked
 * licence is noted, and licensed features turn read-only at once (index.readOnly).
 */
const files = require('./files');
const DAY = 86400000;

const setting = k => { try { return require('../settings-schema').value(`licence.${k}`); } catch { return ''; } };
const base = () => {
  const server = String(setting('server') || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) return null;
  const account = String(setting('account') || '').trim();
  return `${server}/v1${account ? `/accounts/${encodeURIComponent(account)}` : ''}`;
};

async function call(method, url, { body, key } = {}) {
  const headers = { Accept: 'application/vnd.api+json', ...(body ? { 'Content-Type': 'application/vnd.api+json' } : {}), ...(key ? { Authorization: `License ${key}` } : {}) };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const detail = r => r.json?.errors?.[0]?.detail || r.json?.meta?.detail || `the server answered ${r.status}`;

const NEEDS_MACHINE = new Set(['NO_MACHINE', 'NO_MACHINES', 'FINGERPRINT_SCOPE_MISMATCH']);
const REVOKED = new Set(['SUSPENDED', 'BANNED', 'REVOKED']);

/** One check-in. Resolves to {ok, code, detail, restartNeeded}; every outcome is kept in licence-state.json. */
async function checkIn({ now = Date.now(), name = 'DOCA hive' } = {}) {
  const lic = require('./index');
  const s = files.readJson(files.STATE, {});
  const save = patch => files.writeJson(files.STATE, { ...files.readJson(files.STATE, {}), lastTry: new Date(now).toISOString(), ...patch });
  const b = base();
  if (!b) return { ok: false, code: 'offline', detail: 'No licence server is set (licence.server): this hive is renewed by uploading a licence file.' };
  const key = files.readJson(files.CONFIG, {}).key;
  if (!key) return { ok: false, code: 'no_key', detail: 'Enter the licence key first (Settings → System → Licence).' };
  const fingerprint = require('./fingerprint').fingerprint().value;
  try {
    const validate = () => call('POST', `${b}/licenses/actions/validate-key`, { body: { meta: { key, scope: { fingerprint } } } });
    let v = await validate();
    // A revoked licence is deleted on the server (NOT_FOUND); a suspended or banned one says so.
    if (REVOKED.has(v.json?.meta?.code) || (v.json?.meta?.code === 'NOT_FOUND' && files.readText(files.LICENCE))) {
      save({ lastError: v.json.meta.detail || v.json.meta.code, revoked: { code: v.json.meta.code, at: new Date(now).toISOString() } });
      lic.fresh();
      return { ok: false, code: v.json.meta.code, detail: v.json.meta.detail };
    }
    if (!v.json?.data?.id) { save({ lastError: `the key was not accepted: ${detail(v)}` }); return { ok: false, code: v.json?.meta?.code || 'invalid_key', detail: detail(v) }; }
    const id = v.json.data.id;
    if (!v.json.meta?.valid && NEEDS_MACHINE.has(v.json.meta?.code)) {
      const a = await call('POST', `${b}/machines`, { key, body: { data: { type: 'machines', attributes: { fingerprint, name, platform: process.platform },
        relationships: { license: { data: { type: 'licenses', id } } } } } });
      if (a.status >= 300) { save({ lastError: `this machine could not be activated: ${detail(a)}` }); return { ok: false, code: 'activation', detail: detail(a) }; }
      v = await validate();
    }
    if (!v.json?.meta?.valid) { save({ lastError: v.json?.meta?.detail || v.json?.meta?.code }); return { ok: false, code: v.json?.meta?.code || 'invalid', detail: v.json?.meta?.detail }; }
    // What a licence key may read: the licence and its entitlements (the edition and customer are in its metadata).
    const out = await call('POST', `${b}/machines/${encodeURIComponent(fingerprint)}/actions/check-out?encrypt=true&include=license,license.entitlements`, { key });
    const certificate = out.json?.data?.attributes?.certificate;
    if (!certificate) { save({ lastError: `no licence file came back: ${detail(out)}` }); return { ok: false, code: 'checkout', detail: detail(out) }; }
    const checked = accept(certificate, { key, now });
    if (!checked.ok) { save({ lastError: checked.detail }); return checked; }
    save({ lastCheckIn: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), lastError: null, revoked: null });
    lic.fresh();
    note('checked the licence in with its server', `due every ${checked.checkInDays || '—'} days`);
    return { ok: true, code: 'VALID', detail: 'Checked in: the licence file was renewed.', restartNeeded: lic.status().restartNeeded };
  } catch (e) {
    save({ lastError: `the licence server could not be reached: ${e.cause?.code || e.message}` });
    return { ok: false, code: 'unreachable', detail: e.cause?.code || e.message };
  }
}

/** Keep a certificate only if it verifies here and is good for this hive. */
function accept(certificate, { key = files.readJson(files.CONFIG, {}).key || '', now = Date.now() } = {}) {
  const keys = require('./keys');
  const fingerprint = require('./fingerprint').fingerprint().value;
  const { terms, judge } = require('./terms');
  let t;
  try { t = terms(require('./certificate').read(certificate, keys.VENDOR_KEYS, { key, fingerprint }).payload); }
  catch (e) { return { ok: false, code: e.code || 'unreadable', detail: e.message }; }
  const j = judge(t, { fingerprint, now });
  if (!j.valid) return { ok: false, code: j.code, detail: j.why };
  files.write(files.LICENCE, certificate.trim() + '\n');
  return { ok: true, customer: t.customer, edition: t.edition, codes: t.codes, checkInDays: t.checkInDays };
}

function note(what, why) { try { require('../activity').note({ from: 'licence', what, why }); } catch { /* a record, never in the way */ } }

let timer = null;
/** At start: check in when one is due (a quarter of the interval, at least daily), and remember the clock. */
function start() {
  const lic = require('./index');
  const tick = () => {
    lic.touch();
    if (!base() || !files.readJson(files.CONFIG, {}).key) return;
    const s = files.readJson(files.STATE, {});
    const every = Math.max(1, (lic.status().checkInDays || 4) / 4) * DAY;
    const last = Math.max(Date.parse(s.lastCheckIn || 0) || 0, Date.parse(s.lastTry || 0) || 0);
    if (Date.now() - last >= Math.min(every, DAY)) checkIn().catch(() => {});
  };
  tick();
  timer = setInterval(tick, 6 * 3600000);
  timer.unref?.();
}

module.exports = { checkIn, accept, start, stop: () => clearInterval(timer), base };

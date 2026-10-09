'use strict';

/**
 * The licence: what this hive may run (docs/design/licence.md). One build carries every feature; the licence decides
 * which are there. A feature that is not licensed is absent, not refused: its routes are not mounted (gate.js), its
 * tools and its pages are not offered, its tables are not made, its settings are not offered to the agent and its
 * experiment never turns on.
 *
 *   has(code)        whether a licence code (codes.js) is granted — `core` always is
 *   featureOn(f)     whether a feature (an entry of modules/features, or its id) is licensed
 *   readOnly()       why licensed features are read-only now, or null: a licence lapsed past its grace, or the clock set back
 *   status()         everything Settings → System → Licence shows
 *
 * What is granted is read once, at the first question after the hub starts, and kept: a licence added, renewed or
 * removed takes effect at the next start (the panel says so). Going read-only is the exception: it is judged live.
 */
const keys = require('./keys');
const files = require('./files');
const cert = require('./certificate');
const { terms: termsOf, judge, DAY } = require('./terms');
const { ALL } = require('./codes');

let _boot = null;

const fingerprint = () => require('./fingerprint').fingerprint().value;
const state = () => files.readJson(files.STATE, {});
const config = () => files.readJson(files.CONFIG, {});

/** What the licence on disk (or a test's preloaded one) says now, with nothing kept. */
function evaluate(now = Date.now()) {
  const text = files.readText(files.LICENCE) || keys.preloaded.certificate;
  const source = files.readText(files.LICENCE) ? 'file' : keys.preloaded.certificate ? 'test' : null;
  const none = extra => {
    const g = require('./grace').current(now);
    if (g?.active) return { source: 'grace', valid: false, grace: g, codes: [ALL], all: true, ...extra };
    return { source: 'none', valid: false, grace: g, codes: [], all: false, ...extra };
  };
  if (!text) return none({});
  const fp = fingerprint();   // read only when there is a licence to bind (it makes the hive's id the first time)
  let t;
  try { t = termsOf(cert.read(text, keys.VENDOR_KEYS, { key: config().key || '', fingerprint: fp }).payload); }
  catch (e) { return none({ problem: { code: e.code || 'unreadable', why: e.message } }); }
  const j = judge(t, { fingerprint: fp, now, lastCheckIn: state().lastCheckIn || null });
  if (!j.valid) return none({ problem: { code: j.code, why: j.why }, terms: t });
  return { source, valid: true, terms: t, judged: j, codes: t.codes, all: t.codes.includes(ALL), fingerprint: fp };
}

/** The licence in effect: read once, then kept until the next start. */
function boot() {
  if (!_boot) { _boot = evaluate(); if (_boot.source !== 'none') touch(); }
  return _boot;
}

function has(code) {
  if (code === 'core') return true;
  // The lab is a development hive's alone: a production hive never has it, whatever its licence says (edition-mode.js).
  if (String(code).toLowerCase() === 'lab' && require('../edition-mode').production()) return false;
  const b = boot();
  return b.all || b.codes.includes(String(code).toLowerCase());
}

function featureOn(f) {
  if (typeof f === 'string') f = require('../features').get(f);
  if (!f) return true;   // not an indexed feature: nothing to gate
  const code = f.licence || 'core';
  if (code === 'lab' && require('../edition-mode').production()) return false;
  return code === 'core' || has(code) || boot().codes.includes(`feature.${f.id}`);
}

/** Days a lapsed licence keeps working: the owner's setting, never past what the licence allows. */
function graceDays(t) {
  let v = 14;
  try { v = require('../settings-schema').value('licence.graceDays'); } catch { /* the default */ }
  return Math.max(0, Math.min(Number(v) || 0, t?.maxGraceDays ?? 30));
}

/** The latest time this hive has seen, so a clock set back is noticed. */
function touch(now = Date.now()) {
  const s = state();
  if (!s.lastSeen || Date.parse(s.lastSeen) < now) { try { files.writeJson(files.STATE, { ...s, lastSeen: new Date(now).toISOString() }); } catch { /* read-only disk: judged without */ } }
}

let _ro = { at: 0, v: null };
/** Why licensed features are read-only now (a sentence), or null. Live, cached for a few seconds. */
function readOnly(now = Date.now()) {
  if (now - _ro.at < 5000) return _ro.v;
  const b = boot();
  let why = null;
  const st = state(), seen = st.lastSeen;
  if (b.source !== 'none' && st.revoked) why = `The licence server says this licence is ${st.revoked.code === 'NOT_FOUND' ? 'revoked' : String(st.revoked.code).toLowerCase()}; licensed features are read-only. Nothing was removed.`;
  else if (b.source !== 'none' && seen && now < Date.parse(seen) - DAY) why = 'This machine\'s clock was set back past a time the hive has already seen; licensed features are read-only until the hive checks in again.';
  else if (b.source === 'grace' && !require('./grace').current(now)?.active) why = `The grace for adding a licence ended on ${String(require('./grace').current(now)?.until || b.grace.until).slice(0, 10)}; licensed features are read-only until one is added (Settings → System → Licence).`;
  else if (b.valid) {
    const j = judge(b.terms, { fingerprint: b.fingerprint, now, lastCheckIn: state().lastCheckIn || null });
    const days = graceDays(b.terms);
    if (j.valid && j.lapsed && now >= Date.parse(j.lapsesAt) + days * DAY) why = `Licensed features are read-only: ${j.lapsedWhy} (${days} days of grace have passed). Nothing was removed; renew the licence in Settings → System → Licence.`;
    if (!j.valid) why = `Licensed features are read-only: ${j.why}`;
  }
  _ro = { at: now, v: why };
  return why;
}

/** For the panel: in effect, on disk, read-only, and how to add one. Never the licence key. */
function status() {
  const b = boot(), disk = evaluate();
  const s = state(), c = config();
  const same = JSON.stringify([b.source, b.codes]) === JSON.stringify([disk.source, disk.codes]) && (b.terms?.licenceId || null) === (disk.terms?.licenceId || null);
  const t = b.terms || disk.terms || null;
  const j = b.valid ? judge(b.terms, { fingerprint: b.fingerprint, now: Date.now(), lastCheckIn: s.lastCheckIn || null }) : null;
  let server = '', account = '';
  try { server = require('../settings-schema').value('licence.server'); account = require('../settings-schema').value('licence.account'); } catch { /* unset */ }
  return {
    source: b.source, valid: b.valid, all: b.all, codes: b.codes, problem: b.problem || disk.problem || null,
    customer: t?.customer || null, edition: t?.edition || null, expiry: t?.expiry || null, fileExpiry: t?.fileExpiry || null,
    seats: t?.seats ?? null, maxDevices: t?.maxDevices ?? null, checkInDays: t?.checkInDays ?? null,
    lapsesAt: j?.lapsesAt || null, lapsedWhy: j?.lapsed ? j.lapsedWhy : null, graceDays: graceDays(t),
    grace: b.grace || disk.grace || null, readOnly: readOnly(),
    fingerprint: fingerprint(), machineFrom: require('./fingerprint').fingerprint().machineFrom,
    lastCheckIn: s.lastCheckIn || null, lastTry: s.lastTry || null, lastError: s.lastError || null,
    server, account, hasKey: !!c.key, trustsKeys: keys.VENDOR_KEYS.length, mode: require('../edition-mode').state(),
    restartNeeded: !same, onDisk: same ? null : { source: disk.source, valid: disk.valid, codes: disk.codes, problem: disk.problem || null },
  };
}

/** Tests: forget what was read, so the next question reads again (as a restart would). */
/** Judge read-only again at the next question (after a check-in or an upload). */
function fresh() { _ro = { at: 0, v: null }; }

function reload() { _boot = null; _ro = { at: 0, v: null }; require('./fingerprint')._reset(); require('../edition-mode').reload(); }

module.exports = { has, featureOn, readOnly, status, evaluate, boot, touch, fresh, reload, graceDays };

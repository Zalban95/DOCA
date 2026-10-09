'use strict';

/**
 * /api/licence — Settings → System → Licence (public/js/settings/licence.js), and what every page reads to leave out
 * what is not licensed (public/js/lib/licence.js).
 *
 *   GET    /api/licence          what is in effect, what waits for a restart, what is off; the whole of it for a host,
 *                                the pages left out and the banner for anyone else
 *   POST   /api/licence/file     a licence file uploaded (offline renewal), kept only if it verifies for this hive
 *   POST   /api/licence/key      the licence key, and the server to check in with (licence.server / .account)
 *   POST   /api/licence/check    check in now
 *   DELETE /api/licence          remove the licence file (a sandbox's, or one bound to another machine)
 *
 * A change takes effect at the next start, and the answer says so; read-only is judged at once.
 */
const lic = require('./index');
const files = require('./files');

const NEXT_START = 'It takes effect when the hub next starts (Settings → General → Updates → Restart).';

function banner(s) {
  const name = require('../branding').name('product');
  if (s.readOnly) return { level: 'error', text: s.readOnly };
  if (s.source === 'grace') return { level: 'warn', text: `No licence yet — add one before ${s.grace.until.slice(0, 10)}. Until then ${name} keeps every feature; after it, licensed features turn read-only.` };
  if (s.restartNeeded) return { level: 'info', text: `A new licence is ready. ${NEXT_START}` };
  if (s.lapsedWhy && s.lapsesAt) return { level: 'warn', text: `The licence lapsed: ${s.lapsedWhy}. Licensed features keep working for ${s.graceDays} days, then turn read-only.` };
  return null;
}

function view(req) {
  const s = lic.status();
  const off = require('./gate').off();
  const host = require('../auth/rights').can(req.auth?.role, 'host');
  const shared = { source: s.source, valid: s.valid, readOnly: s.readOnly, mode: s.mode.mode, banner: host ? banner(s) : (s.readOnly ? banner(s) : null), off: { pages: off.pages, features: off.features } };
  if (!host) return shared;
  const { CODES, EDITIONS } = require('./codes');
  return { ...s, ...shared, modeWhy: s.mode.why, limits: require('./limits').status(), off, catalogue: { codes: CODES, editions: EDITIONS }, nextStart: NEXT_START };
}

const fail = (res, e, status = 400) => res.status(status).json({ error: e.detail || e.message, code: e.code || 'error' });

function savePrefsLicence(patch) {
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, licence: { ...(prefs.licence || {}), ...patch } });
}

function mount(app) {
  app.get('/api/licence', (req, res) => res.json(view(req)));
  app.post('/api/licence/file', (req, res) => {
    const text = String(req.body?.certificate || '');
    if (req.body?.key) files.writeJson(files.CONFIG, { ...files.readJson(files.CONFIG, {}), key: String(req.body.key).trim() });
    const r = require('./checkin').accept(text);
    if (!r.ok) return fail(res, r);
    const s = files.readJson(files.STATE, {});
    files.writeJson(files.STATE, { ...s, revoked: null });
    lic.fresh();
    note(`a licence file was added (${r.edition || 'no edition named'})`, 'uploaded at Settings → System → Licence');
    res.json({ ok: true, ...r, said: `The licence verifies for this hive. ${NEXT_START}`, licence: view(req) });
  });
  app.post('/api/licence/key', (req, res) => {
    const b = req.body || {};
    const patch = {};
    for (const k of ['server', 'account']) if (typeof b[k] === 'string') patch[k] = b[k].trim();
    if (patch.server && !/^https?:\/\/[^\s]+$/i.test(patch.server)) return fail(res, { message: 'The licence server is an address: https://…' });
    if (Object.keys(patch).length) savePrefsLicence(patch);
    if (typeof b.key === 'string') {
      const c = files.readJson(files.CONFIG, {});
      if (b.key.trim()) files.writeJson(files.CONFIG, { ...c, key: b.key.trim() }); else { delete c.key; files.writeJson(files.CONFIG, c); }
    }
    res.json({ ok: true, licence: view(req) });
  });
  app.post('/api/licence/check', async (req, res) => {
    const r = await require('./checkin').checkIn({ name: require('../branding').name('product') });
    res.status(r.ok ? 200 : 409).json({ ...r, said: r.ok ? (r.restartNeeded ? `Checked in. ${NEXT_START}` : 'Checked in: nothing changed.') : r.detail, licence: view(req) });
  });
  app.delete('/api/licence', (req, res) => {
    files.remove(files.LICENCE);
    lic.fresh();
    note('the licence file was removed', 'removed at Settings → System → Licence');
    res.json({ ok: true, said: `The licence file was removed. ${NEXT_START}`, licence: view(req) });
  });
}

function note(what, why) { try { require('../activity').note({ from: 'licence', what, why }); } catch { /* a record */ } }

module.exports = { mount, view, banner };

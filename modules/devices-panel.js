'use strict';

/**
 * Dashboard-side device management — the UI half of the /api/v1 device
 * registry, exposed on the legacy (browser) API surface.
 *
 * Deliberately *not* a bearer token in the browser. The panel is
 * unauthenticated and reached over a LAN or a tailnet; handing it an admin
 * token would mint a credential that keeps working from anywhere, long after
 * whoever obtained it left the network. Calling devices.js server-side instead
 * keeps the panel's authority bounded by network reach — exactly where it
 * already sits — while still giving devices real, scoped, revocable tokens.
 *
 * Gated by DOCA_LEGACY_TRUST (default on). Set it to 0 to manage devices only
 * with `npm run token` on the host.
 */
const devices = require('./api-v1/devices');
const { PRESETS, FAMILIES } = require('./api-v1/scopes');
const L = require('./api-v1/limits');
const own = require('./devices-own');   // whose devices this request may touch

/** Form factor implied by a preset, so a paired device starts with a sane self-description. */
const PRESET_FORM_FACTOR = { phone: 'phone', watch: 'watch', agent: 'headless', viewer: 'browser' };

function legacyTrusted() {
  const raw = String(process.env.DOCA_LEGACY_TRUST ?? '1').trim();
  return !/^(0|false|off|no)$/i.test(raw);
}

/** Returns true (and answers) when device management from the panel is disabled. */
function blocked(_req, res) {
  if (legacyTrusted()) return false;
  res.status(403).json({
    error: 'legacy_trust_disabled',
    message: 'Managing devices from the dashboard is disabled (DOCA_LEGACY_TRUST=0). Issue tokens on the host with `npm run token`.',
  });
  return true;
}

/** Resolve a preset name or an explicit scope list into scopes. */
function resolveScopes({ preset, scopes }) {
  if (Array.isArray(scopes) && scopes.length) return scopes;
  if (typeof scopes === 'string' && scopes.trim()) return scopes.split(',').map(s => s.trim()).filter(Boolean);
  if (preset && PRESETS[preset]) return PRESETS[preset];
  return null;
}

/** GET /api/devices — registry plus everything the UI needs to render the form. */
/**
 * The preset a paired device's form factor implies. A desktop client pairs
 * with the phone preset (see scopes.PRESETS), so it is compared with that.
 */
function presetFor(d) {
  if (['agent', 'browser', 'channel'].includes(d.kind)) return null;   // a browser or a linked chat holds no token to widen
  if (d.caps?.ext?.client === 'doca-browser') return 'extension';   // the browser extension lends tabs and nothing more
  const ff = d.caps?.formFactor;
  return ff === 'watch' ? 'watch' : ['phone', 'desktop', 'tablet', 'browser', 'other'].includes(ff) ? 'phone' : null;
}

/**
 * Scopes the device's preset grants today that its record does not hold. A
 * record keeps the scopes it was paired with; when a preset grows (harness:chat
 * was added after the desktop client paired) the device never gets it, and the
 * only way out was a re-pair that mints a new identity and orphans the old
 * queue (audit 2026-09-26, N4). Reported, never granted by itself: widening a
 * device's permissions is the owner's click (handleGrant).
 */
function missingScopes(d) {
  const preset = presetFor(d);
  if (!preset || d.revokedAt) return [];
  const { hasScope } = require('./api-v1/scopes');
  return PRESETS[preset].filter(sc => !hasScope(d.scopes, sc));
}

function handleList(req, res) {
  const scope = own.require(req, res);
  if (!scope) return;
  // `mine`: whose page /d/<id>/ this person may open (screens.ensure): their own devices' (TODO H2.4).
  // Without the devices right a person sees only their own (devices-own.js): another's is not there.
  const list = devices.list().filter(d => scope === 'all' || own.isMine(req, d))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(d => ({ ...d, missingScopes: scope === 'all' ? missingScopes(d) : [], preset: presetFor(d), control: require('./devices-control').state(d.id), mine: own.isMine(req, d) }));
  res.json({
    devices: list,
    presets: own.presets(scope),
    families: FAMILIES,
    pairTtlSec: L.PAIR_CODE_TTL_SEC,
    trusted: legacyTrusted(),
    own: scope === 'own',   // the panel draws "Your devices": pairing for yourself, no tokens minted by hand, no grants
  });
}

/** POST /api/devices — mint a token directly. Shown once; only a hash is kept. */
function handleIssue(req, res) {
  if (blocked(req, res)) return;
  const { name, preset, scopes, expiresAt } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });

  const resolved = resolveScopes({ preset, scopes });
  if (!resolved) return res.status(400).json({ error: 'scopes_required', message: `Pass a preset (${Object.keys(PRESETS).join(', ')}) or an explicit scope list.` });

  const r = devices.create({
    name: String(name).trim(),
    scopes: resolved,
    kind: preset === 'agent' ? 'agent' : 'device',
    expiresAt: expiresAt || null,
    caps: { formFactor: PRESET_FORM_FACTOR[preset] || 'other' },
  });
  res.status(201).json(r);
}

/** POST /api/devices/:id/rotate — new token, old one valid for a short grace period. */
function handleRotate(req, res) {
  if (blocked(req, res)) return;
  const scope = own.require(req, res);
  if (!scope) return;
  const d = own.deviceFor(req, scope, req.params.id);
  const r = d && devices.rotate(d.id);
  if (!r) return res.status(404).json({ error: 'unknown_device' });
  own.audit(req, 'device token rotated', d);
  res.json(r);
}

/** PATCH /api/devices/:id { name } — rename one; only its name, so a person's own device keeps the scopes it paired with. */
function handleRename(req, res) {
  if (blocked(req, res)) return;
  const scope = own.require(req, res);
  if (!scope) return;
  const d = own.deviceFor(req, scope, req.params.id);
  if (!d) return res.status(404).json({ error: 'unknown_device' });
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const next = devices.update(d.id, { name });
  own.audit(req, 'device renamed', next, `from ${d.name}`);
  res.json({ device: next });
}

/**
 * DELETE /api/devices/:id — revoke (keeps the audit row) or `?purge=1` to forget
 * entirely. `devices.forget` drops the outbox and the profile with the row; this
 * route used to call `remove()` alone and leave both behind.
 */
function handleRevoke(req, res) {
  if (blocked(req, res)) return;
  const scope = own.require(req, res);
  if (!scope) return;
  const d = own.deviceFor(req, scope, req.params.id);
  if (!d) return res.status(404).json({ error: 'unknown_device' });
  if (req.query.purge === '1') {
    own.audit(req, 'device forgotten', d);
    return devices.forget(d.id)
      ? res.json({ ok: true, purged: true })
      : res.status(404).json({ error: 'unknown_device' });
  }
  own.audit(req, 'device revoked', d);
  return devices.revoke(d.id)
    ? res.json({ ok: true })
    : res.status(404).json({ error: 'unknown_device' });
}

/**
 * POST /api/devices/pair — start a pairing session.
 * Preferred over handing out a token: the code is single-use, lives
 * PAIR_CODE_TTL_SEC, and the device mints its own token via
 * POST /api/v1/devices/pair/complete.
 */
async function handlePairStart(req, res) {
  if (blocked(req, res)) return;
  const scope = own.require(req, res);
  if (!scope) return;
  const { name, preset, scopes, expiresAt, forUser } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });

  // The device belongs to whoever paired it (docs/design/auth.md), or to the person an admin pairs it for — never
  // to someone a person's own request names. A person pairing their own picks a phone-sized preset, never a list.
  let owner;
  try { owner = own.ownerFor(req, scope, forUser); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (owner.scope === 'own' && !own.OWN_PRESETS.includes(preset))
    return res.status(403).json({ code: 'preset_refused', error: `A device of your own pairs as ${own.OWN_PRESETS.join(', ')}; the others are an admin's.` });
  const resolved = owner.scope === 'own' ? own.presets('own')[preset] : resolveScopes({ preset, scopes });
  if (!resolved) return res.status(400).json({ error: 'scopes_required' });

  const p = devices.startPairing({
    name: String(name).trim(),
    scopes: resolved,
    expiresAt: expiresAt || null,
    kind: preset === 'agent' ? 'agent' : 'device',
    createdBy: 'dashboard',
    userId: owner.userId, orgId: owner.orgId,
  });
  own.audit(req, 'device pairing started', { userId: owner.userId, name: String(name).trim() }, `as ${preset || 'a scope list'}${owner.userId !== req.auth.user.id ? ` for ${owner.userId}` : ''}`);

  // The address the phone will dial: the one this page was opened at, unless that is this machine's own loopback,
  // which a phone cannot reach — then the hub's best reachable one (its Tailscale name, else a tailnet or LAN address).
  let host = req.headers.host || '';
  if (/^(localhost|127\.|\[::1\])/i.test(host)) {
    try { const best = (await require('./network').links(req)).links[0]; if (best) host = new URL(best.url).host; } catch { /* keep it */ }
  }
  const url  = `doca://pair?code=${p.code.replace('-', '')}&host=${host}`;

  let qr = null;
  try {
    qr = await require('qrcode').toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      // `width` is what makes the SVG carry width and height attributes. Without
      // it the tag has a viewBox and nothing else, and an inline SVG with no
      // intrinsic size renders at the CSS default 300×150 — so in the 180 px box
      // the panel draws it in, the code came out cropped and would not scan.
      width: 360,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (e) {
    // A missing/broken encoder must not block pairing — the code still works.
    console.warn(`[devices] QR generation unavailable (${e.message}); pairing code still valid.`);
  }

  res.status(201).json({ ...p, url, qr, completeUrl: '/api/v1/devices/pair/complete' });
}

/** POST /api/devices/:id/scopes { add: [...] } — grant what its preset now includes, and nothing else. Same id, queue and token. */
function handleGrant(req, res) {
  if (blocked(req, res)) return;
  const d = devices.list().find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'unknown_device' });
  const may = missingScopes(d);
  const add = [].concat(req.body?.add || []).filter(sc => may.includes(sc));
  if (!add.length) return res.status(400).json({ error: 'nothing_to_grant', message: `Grantable here: ${may.join(', ') || 'nothing'}.` });
  const next = devices.update(d.id, { scopes: [...d.scopes, ...add] });
  try { require('./auth/store').audit({ orgId: req.auth?.orgId, actorId: req.auth?.user?.id, action: 'device scopes granted', detail: `${d.id}: ${add.join(', ')}` }); } catch {}
  res.json({ device: { ...next, tokenHash: undefined, missingScopes: missingScopes(next) } });
}

function mount(app) {
  app.get   ('/api/devices',             handleList);
  app.post  ('/api/devices',             handleIssue);
  app.post  ('/api/devices/pair',        handlePairStart);
  app.post  ('/api/devices/:id/rotate',  handleRotate);
  app.post  ('/api/devices/:id/scopes',  handleGrant);
  app.patch ('/api/devices/:id',         handleRename);
  app.delete('/api/devices/:id',         handleRevoke);
  require('./device-console').mountPanel(app);   // a device as a console: its stream, and who receives it
  require('./device-files').mount(app);   // a device's files, as the Files tab speaks them (device-files.js)
  // Devices as hands (devices-control.js): what a device granted, and the actions on it.
  const control = require('./devices-control');
  app.get   ('/api/devices/:id/control', (req, res) => res.json(control.state(req.params.id)));
  app.post  ('/api/devices/:id/control', (req, res) => {
    try {
      const s = control.send(req.params.id, String(req.body?.action || ''), { family: req.body?.family || null, by: req.auth?.user?.id || null });
      require('./auth/store').audit({ orgId: req.auth?.orgId, actorId: req.auth?.user?.id, action: `device ${req.body?.action}`, detail: `${req.params.id}${req.body?.family ? ` ${req.body.family}` : ''}` });
      res.json(s);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  // A device's own page (docs/design/devices-as-hands.md §5): the panel, personalised for it.
  // The path is a view, never a key — served only to that device's session, or to a person who owns it.
  const page = require('express').static(require('path').join(__dirname, '..', 'public'));
  app.use('/d/:id', (req, res, next) => {
    const d = devices.get(req.params.id);
    const who = req.auth;
    const mine = d && !d.revokedAt && who && (who.session?.deviceId === d.id || (d.userId && d.userId === who.user?.id));
    if (!mine) return res.status(404).type('text/plain').send('Not a device of yours.');
    return page(req, res, next);
  });
}

module.exports = {
  legacyTrusted, mount, missingScopes, presetFor,
  handleList, handleIssue, handleRotate, handleRename, handleRevoke, handlePairStart, handleGrant,
};

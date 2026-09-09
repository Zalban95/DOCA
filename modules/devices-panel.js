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
function handleList(_req, res) {
  const list = devices.list().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({
    devices: list,
    presets: PRESETS,
    families: FAMILIES,
    pairTtlSec: L.PAIR_CODE_TTL_SEC,
    trusted: legacyTrusted(),
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
  const r = devices.rotate(req.params.id);
  if (!r) return res.status(404).json({ error: 'unknown_device' });
  res.json(r);
}

/** DELETE /api/devices/:id — revoke (keeps the audit row) or ?purge=1 to forget entirely. */
function handleRevoke(req, res) {
  if (blocked(req, res)) return;
  if (req.query.purge === '1') {
    return devices.remove(req.params.id)
      ? res.json({ ok: true, purged: true })
      : res.status(404).json({ error: 'unknown_device' });
  }
  return devices.revoke(req.params.id)
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
  const { name, preset, scopes, expiresAt } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required' });

  const resolved = resolveScopes({ preset, scopes });
  if (!resolved) return res.status(400).json({ error: 'scopes_required' });

  const p = devices.startPairing({
    name: String(name).trim(),
    scopes: resolved,
    expiresAt: expiresAt || null,
    kind: preset === 'agent' ? 'agent' : 'device',
    createdBy: 'dashboard',
  });

  const host = req.headers.host || '';
  const url  = `doca://pair?code=${p.code.replace('-', '')}&host=${host}`;

  let qr = null;
  try {
    qr = await require('qrcode').toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (e) {
    // A missing/broken encoder must not block pairing — the code still works.
    console.warn(`[devices] QR generation unavailable (${e.message}); pairing code still valid.`);
  }

  res.status(201).json({ ...p, url, qr, completeUrl: '/api/v1/devices/pair/complete' });
}

module.exports = {
  legacyTrusted,
  handleList, handleIssue, handleRotate, handleRevoke, handlePairStart,
};

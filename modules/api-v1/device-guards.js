'use strict';

/**
 * What a device may do to devices (audit 2026-10-04). Three holes, closed here
 * so router.js only calls them:
 *
 * - A device hands on only scopes it holds. A phone with devices:admin minted
 *   '*' devices and patched itself to '*'.
 * - What a device makes or pairs belongs to whoever the device belongs to.
 *   Ownerless devices escaped the rule that suspending a person silences their
 *   devices (api-v1/auth.js).
 * - Wrong pairing codes are throttled for everyone: the route needs no token,
 *   the codes are six digits and live 300 s. Ten misses a minute leaves ~50
 *   guesses per code's life — one chance in 20 000 — and a person mistyping
 *   twice never notices.
 *
 * (An admin PATCH also never carries userId/orgId/pairedBy — router.js — which
 * turned a member's phone into an owner's panel session.)
 */
const { hasScope } = require('./scopes');
const { ApiError } = require('./errors');

function ownScopesOnly(req, scopes) {
  const held = req.device.scopes || [];
  const extra = (scopes || []).filter(s => !hasScope(held, s));
  if (extra.length) throw new ApiError(403, 'scope_exceeds_own', `This device cannot grant what it does not hold: ${extra.join(', ')}`);
}

const ownerOf = req => ({ userId: req.device.userId || null, orgId: req.device.orgId || null });

const misses = [];
const PAIR_MISSES_PER_MIN = 10;

function pairThrottle(res) {
  while (misses.length && misses[0] < Date.now() - 60e3) misses.shift();
  if (misses.length < PAIR_MISSES_PER_MIN) return;
  res.setHeader('Retry-After', String(Math.ceil((misses[0] + 60e3 - Date.now()) / 1000)));
  throw new ApiError(429, 'pairing_throttled', 'Too many wrong pairing codes in the last minute. Wait a minute and try again.');
}

function pairMissed() { misses.push(Date.now()); }

/** A PATCH body as it may apply: yourself, only caps and name; an admin, name, scopes, expiry and caps — never userId/orgId/pairedBy. */
function patchFor(req, id, body, isAdmin) {
  if (id === req.device.id && !isAdmin) return { caps: body.caps, name: body.name };
  const patch = { name: body.name, scopes: body.scopes, expiresAt: body.expiresAt, caps: body.caps };
  if (patch.scopes !== undefined) ownScopesOnly(req, patch.scopes);
  return patch;
}

/** POST /devices/pair/complete — needs no token, so it is throttled on wrong codes. */
async function pairComplete(req, res) {
  const { code, caps, name } = req.body || {};
  if (!code) throw new ApiError(400, 'invalid_pairing', 'code is required');
  pairThrottle(res);
  const r = require('./devices').completePairing(code, caps, name);
  if (!r) { pairMissed(); throw new ApiError(400, 'invalid_pairing', 'Pairing code is unknown or expired'); }
  res.status(201).json({ token: r.token, device: r.device, capabilitiesUrl: '/api/v1/capabilities', protocol: require('./limits').PROTOCOL_VERSION });
}

module.exports = { ownScopesOnly, ownerOf, patchFor, pairComplete, pairThrottle, pairMissed, PAIR_MISSES_PER_MIN };

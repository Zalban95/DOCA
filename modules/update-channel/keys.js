'use strict';

/**
 * Who may sign a DOCA release for the update channel (docs/design/production.md): Ed25519 public keys, 64 hex
 * characters each, as `npm run release-key` in doca-licensing prints them. A list, so a key can rotate as the licence's
 * vendor keys do (license/keys.js).
 *
 * A key of its own, apart from the licence server's account key, on purpose: that key lives inside the licence server
 * (Keygen signs licence files with it), and a server that is broken into must not be able to send every customer code
 * to run. The release key is kept offline, beside the scripts that publish (doca-licensing/.secrets, never committed).
 *
 * This is a trust anchor, so it lives in code, never in a setting; adding or removing a key asks the admin first
 * (CONSTITUTION S11, keys). Empty: no release verifies, and the channel says so — a hive keeps running what it has.
 * Tests trust a key of their own through test/update-trust.js, which only test code loads.
 */
const RELEASE_KEYS = [
  // { id: 'release-<YYYY-MM>', hex: '<64 hex characters>', note: 'where the private half is kept' },
  // Made 2026-10-09 with `npm run release-key` in doca-licensing (the owner's yes, 2026-10-09).
  { id: 'project-release-2026-10', hex: 'ca127733c02b4f3387c855ddd06390b48ad9d622cdf571b619508cea0538ff38', note: 'doca-licensing .secrets/release-signing.pem, with a copy kept offline by the owner' },
];

module.exports = { RELEASE_KEYS };

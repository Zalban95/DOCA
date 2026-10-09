'use strict';

/**
 * Who may sign a licence for this product: the Ed25519 verify keys of the Keygen accounts that issue DOCA licences
 * (docs/design/licence.md). A list, so a key can rotate: the new key is added in a release, licences are re-issued
 * under it, and the old one leaves in a later release. Each key is the account's Ed25519 public key as Keygen shows
 * it (Settings → Public keys → Ed25519, 64 hex characters).
 *
 * This is the trust anchor, so it lives in code, never in a setting: a setting would let anyone sign their own.
 * Adding or removing a key is a change to what the product trusts — it asks the admin first (CONSTITUTION S11, keys).
 *
 * Empty until the owner's licence server exists: every hive then runs `core`, or the grace an existing install was
 * given (grace.js). Tests trust a key of their own through test/licence-trust.js, which only test code loads; nothing
 * in the product reads an environment variable to trust one.
 */
const VENDOR_KEYS = [
  // { id: 'protolab-2026', hex: '<64 hex characters>', note: 'the licence server set up on …' },
];

/** A licence certificate a test preloads when a hive has none of its own (test/licence-trust.js); null in the product. */
const preloaded = { certificate: null };

module.exports = { VENDOR_KEYS, preloaded };

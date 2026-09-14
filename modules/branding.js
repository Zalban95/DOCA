'use strict';

/**
 * Every name this product shows a person, in one place.
 *
 * The panel is sold, or will be: under this name, under a customer's own name
 * on a private label, and eventually under whatever the public release is
 * called. A rename that means grepping forty files is a rename that does not
 * happen, so the strings a person reads come from here and nowhere else.
 *
 * ── What belongs here, and what emphatically does not ──────────────────────
 *
 * Here: window titles, the chat header, the boot line, anything rendered to a
 * screen or written into a log for a human.
 *
 * NOT here, and not renameable at all:
 *
 *   ~/.openclaw/…, openclaw.json      paths on disk that already exist
 *   openclaw-panel.service            a systemd unit somebody has enabled
 *   the OpenClaw harness in catalog   a real third-party product, not our label
 *   github.com/openclaw/openclaw      somebody else's repository
 *   openclaw-dashboard (package.json) an npm identifier, and a separate decision
 *   DOCA_DATA_DIR, DOCA_PREFS_FILE…   environment variables in people's shells
 *   the `doca` harness id, the med_/job_/trn_ prefixes, the /api paths
 *
 * Those are identifiers, not branding: renaming one does not rebrand anything,
 * it breaks an install. The test for which is which is simple — if changing the
 * string would make an existing machine stop working, it is not branding.
 *
 * Overrides live in prefs under `branding`, so a private label is a settings
 * change rather than a build. There is no UI for it yet and that is deliberate:
 * when there is one it goes behind the admin password, because the one thing
 * worse than a product with the wrong name is a product an agent renamed.
 */
const DEFAULTS = {
  /** The product, on its own. Used wherever one word is wanted. */
  product: 'DOCA',
  /** The thing running on this machine, in full. */
  panel: 'DOCA Panel',
  /** The built-in harness, as a person refers to it. */
  agent: 'DOCA Agent',
  /** Whose product it is. */
  vendor: 'Protolab',
  /** One line, for an about box or a page title. */
  tagline: 'Local-first control panel',
};

/** Prefs are read lazily: this module is required early and must not need them. */
function overrides() {
  try {
    const { loadPrefs } = require('./utils');
    const b = loadPrefs().branding;
    return b && typeof b === 'object' ? b : {};
  } catch { return {}; }
}

/**
 * One name. An unknown key answers with the product name rather than
 * `undefined`, because a missing brand string should read as unbranded, not as
 * a bug in a title bar.
 */
function name(key) {
  const o = overrides();
  return (typeof o[key] === 'string' && o[key].trim()) || DEFAULTS[key] || DEFAULTS.product;
}

/** Everything at once, for the front end and for a settings screen. */
function all() {
  return { ...DEFAULTS, ...overrides() };
}

module.exports = { DEFAULTS, name, all };

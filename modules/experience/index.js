'use strict';

/**
 * A screen's `experience` (schema.js), made whole: every field one of its choices, anything else its default. The
 * screens module runs a saved value through it, so a hand-written or older value never reaches a page; the browser
 * keeps the same rule (public/js/flow/flow.js flowNormalize), held equal by test/flow-experience.test.js.
 */
const SCHEMA = require('./schema');

function normalize(v) {
  const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const out = {};
  for (const [k, d] of Object.entries(SCHEMA.keys)) out[k] = d.oneOf.includes(src[k]) ? src[k] : d.default;
  return out;
}

const DEFAULTS = normalize({});

module.exports = { normalize, DEFAULTS, SCHEMA };

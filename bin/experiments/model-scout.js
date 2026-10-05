'use strict';

/**
 * `npm run experiment -- model-scout` (docs/experiments/model-scout.md): one look against the real Hugging Face and the
 * feeds, kept nowhere — what the daily routine would see. No model is asked.
 */
async function measure() {
  const signals = require('../../modules/scout/signals'), roles = require('../../modules/scout/roles').roles();
  const t0 = Date.now();
  const r = await signals.look({ roles, keep: false });
  console.log(signals.brief(r, roles));
  const fast = r.models.filter(m => m.fast).length;
  console.log(`\n| ${r.at.slice(0, 10)} | ${roles.length} | ${r.models.length} | ${r.first ? 'first look' : fast} | ${r.fresh.filter(i => i.kind === 'release').length} / ${r.fresh.filter(i => i.kind === 'news').length} | ${((Date.now() - t0) / 1000).toFixed(1)} |`);
  return r.failures.length && !r.models.length ? 1 : 0;
}

module.exports = { measure };

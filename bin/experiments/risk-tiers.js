'use strict';

/**
 * `npm run experiment -- risk-tiers` (docs/experiments/risk-tiers.md): the classifier on a fixed list of labelled calls
 * (bin/lib/risk-cases.js), with no model — how many land in their labelled tier, and the precision and recall of
 * "outward", the tier that asks. Prints the write-up's results row, then any call it got wrong.
 */
async function measure() {
  const { classify } = require('../../modules/harness/risk/classify');
  const cases = require('../lib/risk-cases');
  let right = 0, tp = 0, fp = 0, fn = 0;
  const wrong = [];
  for (const [label, name, args, where] of cases) {
    const got = classify(name, args, where || {}).tier;
    if (got === label) right++; else wrong.push(`${name} ${JSON.stringify(args)}: labelled ${label}, got ${got}`);
    if (got === 'outward' && label === 'outward') tp++;
    if (got === 'outward' && label !== 'outward') fp++;
    if (got !== 'outward' && label === 'outward') fn++;
  }
  const ratio = (a, b) => (b ? (a / b).toFixed(2) : '—');
  console.log('| date | cases | right | outward precision | outward recall | wrong |');
  console.log(`| ${new Date().toISOString().slice(0, 10)} | ${cases.length} | ${right} | ${ratio(tp, tp + fp)} | ${ratio(tp, tp + fn)} | ${wrong.length || '—'} |`);
  for (const w of wrong) console.log(`  ${w}`);
  return 0;
}

module.exports = { measure };

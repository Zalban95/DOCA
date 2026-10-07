'use strict';

/**
 * Which alternatives go unused (CONSTITUTION W14; TODO H10.7, reshaped by P1.7). An alternative is a candidate when
 * it has not been used for `features.idleDays` (30) while the feature it stands beside ran `features.replacementRuns`
 * (50) times in that time. The recommendation is only ever to hide it from the default — it keeps working, and the
 * agents still find it in the index; taking a feature out of the product is the admin's explicit decision, never
 * this list's.
 */
const usage = require('./usage');

function review(now = Date.now()) {
  const sc = require('../settings-schema'), features = require('./index');
  const idleDays = sc.value('features.idleDays'), runs = sc.value('features.replacementRuns');
  const off = features.hidden();
  return features.all().filter(f => f.state === 'alternative').map(f => {
    const beside = features.get(f.beside);
    const own = usage.of(f.uses);
    const from = own.last || usage.began();                     // never used: since counting began
    const idle = Math.floor((now - Date.parse(from)) / 86400000);
    const replacement = beside?.uses ? usage.since(beside.uses, from) : null;
    const candidate = idle >= idleDays && replacement != null && replacement >= runs;
    const hiddenNow = off.has(f.id);
    const recommendation = hiddenNow ? 'Hidden from the default. It still works and the agents still find it; show it again whenever you like.'
      : candidate ? `Unused for ${idle} days while ${beside.name} ran ${replacement} times: hide it from the default (it keeps working).`
      : own.n ? 'In use: keep it as it is.'
      : `Not used yet; too early to tell (a candidate after ${idleDays} days and ${runs} uses of ${beside?.name || f.beside}).`;
    return { id: f.id, name: f.name, beside: f.beside, besideName: beside?.name || f.beside, uses: own.n, last: own.last,
      idleDays: idle, replacementRuns: replacement, candidate, hidden: hiddenNow, recommendation };
  });
}

/** The review for the agent: the candidates first, every alternative's usage after. */
function lines(rows = review()) {
  const order = rows.slice().sort((a, b) => (b.candidate - a.candidate) || (a.uses - b.uses));
  return order.map(r => `• ${r.name} (${r.id}) beside ${r.besideName}: used ${r.uses} time${r.uses === 1 ? '' : 's'}`
    + `${r.last ? `, last ${r.last.slice(0, 10)}` : ''}; replacement since then: ${r.replacementRuns ?? 'not counted'}.\n  ${r.recommendation}`);
}

module.exports = { review, lines };

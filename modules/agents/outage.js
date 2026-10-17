'use strict';

/**
 * A mission's turn that failed because no model answered — every rung of its chain stalled or said it was out of
 * capacity (turn/transport.js marks that error `stalled`) — is an outage, not the errand failing (2026-10-17: ten team
 * members asked DeepSeek at once, flash and pro both stalled on one step, the local model failed to load, and the
 * member failed — its team spent a retry on it). A person in a chat is told at once and decides; nobody watches a
 * mission, so it is paused and carried on in its own conversation after a wait, with what it did so far, up to three
 * times (1, 3 and 7 minutes); then it fails as before, with why. The chain itself still never loops within a step.
 * A restart while it waits carries it on too (missions.recover). Each pause and carry-on is an activity line.
 */
const WAITS = [60e3, 180e3, 420e3];

/** No model answered: a stall or out of capacity down the chain, a server error (llama.cpp: "failed to load"), or no connection. */
const isOutage = e => !!e?.stalled || Number(e?.status) >= 500
  || /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|fetch failed|socket hang up/i.test(`${e?.code || ''} ${e?.cause?.code || ''} ${e?.message || ''}`);

/** missions.run's ending on an error: paused for an outage, or failed / cancelled as before. */
function ended(id, def, e, { get, patch, announce, run }) {
  const row = get(id);
  const error = String(e?.message || e).slice(0, 600);
  const n = row?.outages || 0;
  if (isOutage(e) && e?.name !== 'AbortError' && row?.state === 'running' && n < WAITS.length) {
    const wait = WAITS[n];
    announce(patch(id, { state: 'paused', pausedFor: 'outage', pausedAt: new Date().toISOString(), outages: n + 1, error }));
    require('../activity').note({ from: 'missions', sessionId: row.sessionId || null,
      what: `paused ${row.label} (${id}) at step ${row.steps}: no model answered`, why: `${error.split('\n')[0]} — it carries on in ${Math.round(wait / 60e3)} min (outage ${n + 1} of ${WAITS.length})` });
    const t = setTimeout(() => carryOn(id, def, { get, patch, announce, run }), wait);
    t.unref?.();
    return;
  }
  announce(patch(id, { state: e?.name === 'AbortError' ? 'cancelled' : 'failed', endedAt: new Date().toISOString(),
    error: isOutage(e) && n >= WAITS.length ? `${error}\n(no model answered after ${n} waits for it)` : error }));
}

function carryOn(id, def, { get, patch, announce, run }) {
  const row = get(id);
  if (row?.state !== 'paused' || row.pausedFor !== 'outage') return;   // stopped, or carried on by a restart meanwhile
  const resumed = patch(id, { state: 'running', pausedFor: null, resumedAt: new Date().toISOString() });
  announce(resumed);
  require('../activity').note({ from: 'missions', sessionId: row.sessionId || null, what: `carried on ${row.label} (${id}) after an outage`, why: 'no model had answered; work goes on until it is finished (V10)' });
  run(resumed, def, `No model answered your last step (${String(row.error || '').split('\n')[0].slice(0, 200)}), so your work `
    + `paused for a while. What you already did is above. Carry on from there; do not redo finished work.\n\nThe errand: ${row.task}`,
  { steps: row.steps || 0, tokens: row.tokens || 0 });
}

module.exports = { ended, isOutage, WAITS };

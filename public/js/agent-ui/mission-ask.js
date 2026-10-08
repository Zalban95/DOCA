/* A mission asking its person to use a machine (modules/harness/mission-asks.js): the owner's rule of 2026-10-08, "if
   the agents need a machine to test something, they might ask for confirmation". The question comes on the live feed's
   `ask` topic — only to this person's pages — and opens the same approval popup a turn's own question does; the answer
   from another page or a device takes it down. A page opened while one waits finds it in GET /api/harness/approval. */

function _missionAskShow(req) {
  if (!req?.id || typeof approvalPopup !== 'function') return;
  approvalPopup(req);
}

async function _missionAskWaiting() {
  try {
    const a = await apiFetch('/api/harness/approval');
    for (const req of a.asks || []) { _missionAskShow(req); break; }   // one popup at a time; the next comes when it is answered
  } catch { /* signed out, or no right to chat */ }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  if (typeof liveOn !== 'function') return;
  liveOn('ask', c => {
    if (c.what === 'asked') return _missionAskShow(c.req);
    if (c.what === 'answered') { approvalPopupClose(c.id); _missionAskWaiting(); }
    if (c.what === 'resync') _missionAskWaiting();
  });
  _missionAskWaiting();
});

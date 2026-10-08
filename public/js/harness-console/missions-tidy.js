/* The missions bar's tidy-up (modules/agents/tidy.js): finished missions nobody needs any more go to the Archive by
   themselves — seen a while ago, or finished a day ago — unless their leader has not read them, a person is still
   asked something about them, or a person kept them with 📌. The bar says quietly how many went today, links the
   Archive, and offers "Put away finished" to do it at once. */

/** 📌 on a finished mission's row: kept out of the tidy-up, or let go again. */
function hcMissionPinHtml(m) {
  const on = !!m.pinned;
  return `<button class="btn btn-xs${on ? ' btn-amber' : ''}" onclick="hcMissionPin(${jsArg(m.id)}, ${!on})"
    title="${on ? 'Kept: the tidy-up leaves it here. Click to let it be put away again.' : 'Keep it: the tidy-up will not put it away in the Archive.'}">📌</button>`;
}

/** The end of the bar: "Put away finished" when there is something finished, and how many went to the Archive today. */
function hcMissionsTidyHtml(rows, putAway) {
  const finished = (rows || []).some(m => ['done', 'failed', 'cancelled'].includes(m.state));
  if (!finished && !putAway) return '';
  return `<span class="hc-missions-tidy">
    ${finished ? `<button class="btn btn-xs" onclick="hcMissionsPutAway()" title="Put every finished mission in the Archive now — except one its leader has not read, one waiting for you, or one kept with 📌">Put away finished</button>` : ''}
    ${putAway ? `<a href="#" onclick="nav('archive');return false" title="Finished missions put away in the last day; each comes back from the Archive">${putAway} put away — Archive</a>` : ''}
  </span>`;
}

async function hcMissionPin(id, on) {
  try { await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}/pin`, { method: 'POST', body: { on } }); } catch (e) { return appAlert(e.message); }
  _hcLoadMissions();
}

async function hcMissionsPutAway() {
  let r;
  try { r = await apiFetch('/api/harness/missions/tidy', { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  hcMissionPeekHide();
  _hcLoadMissions();
  // Say what stayed and why, so a row that did not go is not read as a click that failed.
  if (r.kept?.length) appAlert(`${r.putAway.length} put away. ${r.kept.length} kept:\n${r.kept.slice(0, 6).map(k => `• ${k.label || k.id} — ${k.why}`).join('\n')}`);
}

/* Settings → System → Settings checkpoints (modules/checkpoints.js): every saved change keeps the version it replaced —
   a person's, an applied proposal, Unattended mode's own — with which settings changed, to restore in one click.
   Restoring is a change too, so it can be undone the same way. A host's. */
let _checkpointsShown = [];
async function checkpointsRender() {
  const panel = document.querySelector('#sp-system .scroll-y') || document.getElementById('sp-system');
  if (!panel || (typeof authHasRight === 'function' && !authHasRight('host'))) return;
  let list = [];
  try { ({ checkpoints: list } = await apiFetch('/api/settings/checkpoints')); } catch { return; }
  _checkpointsShown = list;
  document.getElementById('checkpoints-card')?.remove();
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'checkpoints-card' });
  card.innerHTML = `<div class="card-title">Settings checkpoints</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Before every saved change the settings as they were are kept (the last 200), so any change —
      yours, an accepted proposal, the agent's in Unattended mode — can be put back. Restoring is a change too, and can be undone the same way.</p>
    ${list.length ? `<div style="max-height:320px;overflow:auto">${list.map(c => `<div class="tool-row" style="grid-template-columns:auto 1fr auto;align-items:center">
        <span class="tool-label" style="font-size:11px">${escHtml(new Date(c.at).toLocaleString())}</span>
        <span class="tool-note" style="white-space:normal" title="${escHtml((c.leaves || []).join('\n'))}">changed after it: ${escHtml(c.changed.join(', '))}</span>
        <span class="tool-actions"><button class="btn btn-xs" onclick="checkpointRestore(${jsArg(c.id)})" title="Put back only what this change changed">↶ Undo this change</button></span></div>`).join('')}</div>`
      : '<div class="placeholder" style="font-size:12px">No change saved yet.</div>'}`;
  panel.append(card);
}

/** Undo one change: only the settings it changed go back — listed first, so nothing else is a surprise (deep test A, c B4). */
function checkpointRestore(id) {
  const c = (_checkpointsShown || []).find(x => x.id === id);
  const what = c?.leaves?.length ? ` It changed: ${c.leaves.join(', ')}${c.more ? ` and ${c.more} more` : ''}.` : '';
  appConfirm(`Put back only what this change changed?${what} Everything else stays as it is now. Today's settings become a checkpoint first, so this can be undone. Some changes (paths) apply after a restart.`, async () => {
    try { const r = await apiFetch(`/api/settings/checkpoints/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} }); appAlert(`Put back: ${(r.leaves || r.changed).join(', ') || 'nothing differed'}.`); }
    catch (e) { appAlert(e.message); }
    checkpointsRender();
  });
}

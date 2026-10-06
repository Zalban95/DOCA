/* Field → Models → Models in use (modules/model-roles.js; audit 2026-10-06, TODO C4): which model does what — the
   agent's, its fallbacks and escalation, assistant mode's, the specialists', speech both ways, the live call's,
   reading a screen, finding by meaning, the guards, the wake word — and where each is changed. One list, the same the
   agent reads through settings_read and the model scout compares the world against. */
async function modelsRolesCard() {
  const page = document.getElementById('tab-models');
  if (!page) return;
  let card = document.getElementById('models-roles-card');
  if (!card) {
    card = Object.assign(document.createElement('div'), { className: 'card', id: 'models-roles-card' });
    page.prepend(card);
  }
  let roles;
  try { ({ roles } = await apiFetch('/api/models/roles')); }
  catch (e) { card.innerHTML = `<div class="card-title">Models in use</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const rows = roles.filter(r => r.id !== 'new').map(r => `<tr>
      <td style="padding:3px 8px 3px 0">${escHtml(r.label)}</td>
      <td style="padding:3px 8px;${r.current ? '' : 'color:var(--muted)'}">${escHtml(r.current || 'nothing set')}</td>
      <td style="padding:3px 0;color:var(--muted);font-size:11px">${escHtml(r.where)}</td></tr>`).join('');
  card.innerHTML = `<div class="card-title">Models in use</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:6px">Which model does each job in this hive, and where to change it.</p>
    <div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">${rows}</table></div>`;
}

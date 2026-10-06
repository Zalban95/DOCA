/* ═══════════════════════════════════════════════════════
   Settings → System → This host: what this machine can do, probed per OS
   (GET /api/host/capabilities, modules/host-capabilities.js; hive.md §7).
   Absent things say what would supply them, rather than failing later.
   ═══════════════════════════════════════════════════════ */

const _HOST_ROWS = [['shell', 'Shell'], ['boot', 'Start at boot'], ['gpu', 'GPU'], ['containers', 'Containers'], ['vms', 'Virtual machines'],
  ['browser', 'Browser for the agent'], ['inference', 'Local inference'], ['git', 'git'], ['python', 'Python'], ['tailscale', 'Tailscale']];

async function hostCapsLoad(fresh = false) {
  const panel = document.getElementById('sp-system');
  if (!panel) return;
  let card = document.getElementById('host-caps-card');
  if (!card) {
    card = document.createElement('div');
    card.className = 'card';
    card.id = 'host-caps-card';
    panel.prepend(card);
  }
  let c;
  try { c = await apiFetch(`/api/host/capabilities${fresh ? '?fresh=1' : ''}`); }
  catch (e) { card.innerHTML = `<div class="card-title">The hub</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">The hub — this machine
      <button class="btn btn-xs" onclick="hostCapsLoad(true)" title="Look again">↺</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">${escHtml(`${c.os.name} ${c.os.release} · ${c.os.arch} · ${c.os.cpus} CPUs · ${c.os.memoryGB} GB · Node ${c.node}`)}</p>
    ${_HOST_ROWS.map(([k, label]) => { const r = c[k] || {};
      return `<div class="disk-row"><span class="disk-label">${r.available ? '●' : '○'} ${escHtml(label)}</span>
        <span class="disk-path" title="${escHtml(r.via || '')}">${escHtml(r.via || '')}</span>
        <span class="disk-free" style="${r.available ? '' : 'color:var(--muted)'}">${escHtml(r.note || (r.available ? 'available' : 'absent'))}</span></div>`; }).join('')}`;
  hostMigrationsDraw(card);
}

/* What an update changed in the prefs file: renamed or moved keys (GET /api/settings/migrations, migrations.js). */
async function hostMigrationsDraw(card) {
  let m;
  try { m = (await apiFetch('/api/settings/migrations')).migrations || []; } catch { return; }
  if (!m.length) return;
  const el = document.createElement('details');
  el.style.cssText = 'margin-top:10px;font-size:11px';
  el.innerHTML = `<summary style="cursor:pointer;color:var(--muted)">Settings migrations · ${m.filter(x => x.applied).length} of ${m.length} applied</summary>
    ${m.map(x => `<div style="margin:6px 0 0 12px"><b>${escHtml(x.id)}</b> ${x.applied ? '✓' : '…'} ${escHtml(x.note || '')}
      <div style="color:var(--muted)">${escHtml((x.changed.length ? x.changed : x.steps).join(' · '))}${x.changed.length ? ` — here, ${escHtml(new Date(x.at).toLocaleString())}` : ''}</div></div>`).join('')}`;
  card.appendChild(el);
}

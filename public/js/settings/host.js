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
  catch (e) { card.innerHTML = `<div class="card-title">This host</div><div class="placeholder">${escHtml(e.message)}</div>`; return; }
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">This host
      <button class="btn btn-xs" onclick="hostCapsLoad(true)" title="Look again">↺</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">${escHtml(`${c.os.name} ${c.os.release} · ${c.os.arch} · ${c.os.cpus} CPUs · ${c.os.memoryGB} GB · Node ${c.node}`)}</p>
    ${_HOST_ROWS.map(([k, label]) => { const r = c[k] || {};
      return `<div class="disk-row"><span class="disk-label">${r.available ? '●' : '○'} ${escHtml(label)}</span>
        <span class="disk-path" title="${escHtml(r.via || '')}">${escHtml(r.via || '')}</span>
        <span class="disk-free" style="${r.available ? '' : 'color:var(--muted)'}">${escHtml(r.note || (r.available ? 'available' : 'absent'))}</span></div>`; }).join('')}`;
}

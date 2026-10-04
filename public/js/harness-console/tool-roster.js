/* ═══════════════════════════════════════════════════════
   What an agent type holds, and why (TODO H15.3; modules/harness/tool-roster.js):
   the Orchestrator, a work chat or one specialist — each tool under its kit with
   the line its prompt reads and the reason it is held, then what it is refused.
   A missing tool is seen here before a turn fails on it.
   ═══════════════════════════════════════════════════════ */

let _hcRoster = null;

async function hcAgentTools(type) {
  let r;
  try { r = await apiFetch(`/api/harness/agents/${encodeURIComponent(type)}/tools`); } catch (e) { return appAlert(e.message); }
  hcAgentToolsClose();
  const byKit = {};
  for (const t of r.held) (byKit[t.kit] = byKit[t.kit] || []).push(t);
  const row = t => `<div class="hc-roster-row" title="${escHtml(t.what)}"><code>${escHtml(t.name)}</code><span>${escHtml(t.what)}</span><em>${escHtml(t.why)}</em></div>`;
  const kits = Object.entries(byKit).map(([k, list]) => `<div class="hc-roster-kit">${escHtml(r.kitLabels[k] || 'Other')} · ${list.length}</div>${list.map(row).join('')}`).join('');
  const ov = document.createElement('div');
  ov.className = 'hc-roster';
  ov.onclick = e => { if (e.target === ov) hcAgentToolsClose(); };
  ov.innerHTML = `<div class="hc-roster-box">
      <div class="hc-roster-head"><b>${escHtml(r.label)}</b> holds ${r.held.length} tool${r.held.length === 1 ? '' : 's'}
        <span class="hc-roster-dim">${escHtml(r.kits === '*' ? 'every kit' : `kits: ${(r.kits || []).join(', ') || 'none'}`)}</span>
        <span style="flex:1"></span><button class="btn btn-xs" onclick="hcAgentToolsClose()">✕</button></div>
      <div class="hc-roster-note">What its prompt's "Your tools" reads, and why each is held. MCP servers' tools appear while they run.</div>
      <div class="hc-roster-list">${kits || '<div class="placeholder">No tools.</div>'}
        ${r.refused.length ? `<div class="hc-roster-kit">Refused · ${r.refused.length}</div>${r.refused.map(row).join('')}` : ''}</div></div>`;
  document.body.appendChild(ov);
  _hcRoster = { ov, release: overlayBack(() => hcAgentToolsClose(true)) };
}

function hcAgentToolsClose(fromBack) {
  if (!_hcRoster) return;
  const { ov, release } = _hcRoster;
  _hcRoster = null;
  ov.remove();
  if (!fromBack) release();
}

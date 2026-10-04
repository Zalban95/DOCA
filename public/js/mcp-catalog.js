/* ═══════════════════════════════════════════════════════
   MCP → the catalogue (modules/mcp/catalog.js; TODO H5.1): servers the panel
   knows how to add — browser control first — each a fixed command, added with
   a click and started when you say. The agent can only propose one
   (install_propose kind "mcp").
   ═══════════════════════════════════════════════════════ */

async function mcpCatalogRender() {
  const list = document.getElementById('mcp-list');
  if (!list) return;
  let servers = [];
  try { servers = (await apiFetch('/api/mcp/catalog')).servers || []; } catch { return; }
  const fresh = servers.filter(s => !s.added);
  document.getElementById('mcp-catalog')?.remove();
  if (!fresh.length) return;
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'mcp-catalog' });
  card.innerHTML = `<div class="card-title">From the catalogue</div>
    ${fresh.map(s => `<div class="disk-row">
      <span class="disk-label">${escHtml(s.label)}</span>
      <span class="disk-path" title="${escHtml(s.command)}">${escHtml(s.about)}${s.missing.length ? ` <b style="color:var(--amber)">Needs ${escHtml(s.missing.join(', '))} on this host.</b>` : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-blue" onclick="mcpCatalogAdd(${jsArg(s.id)})" title="${escHtml(s.command)}">Add</button></span></div>`).join('')}`;
  list.append(card);
}

async function mcpCatalogAdd(id) {
  try {
    await apiFetch(`/api/mcp/catalog/${encodeURIComponent(id)}`, { method: 'POST' });
    appConfirm('Added. Start it now? Its tools reach the agent while it runs.', async () => {
      try { await apiFetch(`/api/mcp/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action: 'start' } }); } catch (e) { appAlert(e.message); }
      mcpLoad();
    }, () => mcpLoad());
  } catch (e) { appAlert(e.message); }
}

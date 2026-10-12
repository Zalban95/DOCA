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
  if (fresh.some(s => s.id === 'home-assistant')) card.dataset.helpAsk = 'Help me connect Home Assistant: add its MCP Server integration, make a long-lived token, and connect it here — I have the Home Assistant app.';
  const row = s => `<div class="disk-row row3">
      <span class="disk-label">${escHtml(s.label)}</span>
      <span class="disk-path" title="${escHtml(s.command)}">${escHtml(s.about)}${s.missing.length ? ` <b style="color:var(--amber)">Needs ${escHtml(s.missing.join(', '))} on this host.</b>` : ''}</span>
      <span class="disk-free">${s.installable && s.missing.length ? `<button class="btn btn-xs btn-teal" onclick="mcpCatalogInstall(${jsArg(s.id)}, this)" title="Its latest release for this system, checked against its published checksums, into this hub's data folder">Install</button>`
        : `<button class="btn btn-xs" onclick="mcpCatalogAdd(${jsArg(s.id)}, ${jsArg(s.transport)})" title="${escHtml(s.command)}">Add</button>`}</span>
      ${APP_LINKS[s.id]?.flows?.mcp ? `<details class="desc page-about app-steps-row"><summary>How, step by step</summary>${appStepsHtml(s.id, 'mcp')}</details>` : ''}</div>`;
  // A suggested kit (the Craft App Suite) folds under its own name: one choice among others, never in the way.
  const kits = [...new Set(fresh.filter(s => s.kit).map(s => s.kit))];
  card.innerHTML = `<div class="card-title">From the catalogue</div>
    ${fresh.filter(s => !s.kit).map(row).join('')}
    ${kits.map(k => { const inKit = fresh.filter(s => s.kit === k); const have = inKit.filter(s => !s.missing.length).length;
      return `<details class="desc page-about" style="margin-top:10px"><summary><b>${escHtml(k)}</b> — ${inKit.length} open-source creative apps, each a server${have ? `, ${have} installed here` : ''} (suggested)</summary>
        <div style="margin:8px 0"><button class="btn btn-xs" onclick="mcpCatalogKitAll(${jsArg(k)}, this)">Install and add all</button> <span class="desc" id="mcp-kit-progress"></span></div>${inKit.map(row).join('')}</details>`; }).join('')}`;
  list.append(card);
}

async function mcpCatalogAdd(id, transport) {
  try {
    await apiFetch(`/api/mcp/catalog/${encodeURIComponent(id)}`, { method: 'POST' });
    // A server at an address needs its address and token before it can start: straight to its form.
    if (transport === 'http') {
      await mcpLoad(); await mcpEdit(id);
      setStatus(document.getElementById('mcp-form-status'), 'Added, off. Check its address and Save; its token is the key named on its row (Field → Connectors → API services). Then Connect it — or ✨ Ask the agent.', '');
      document.getElementById('mcp-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    appConfirm('Added. Start it now? Its tools reach the agent while it runs.', async () => {
      try { await apiFetch(`/api/mcp/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action: 'start' } }); } catch (e) { appAlert(e.message); }
      mcpLoad();
    }, () => mcpLoad());
  } catch (e) { appAlert(e.message); }
}

/** A server's token kept as a key for services: where it is pasted, and — for a service in lib/app-links.js — where it is made. */
function mcpKeyNoteHtml(s) {
  let base = '';
  try { base = new URL(s.url).origin; } catch { /* no address yet */ }
  const made = APP_LINKS[s.key]?.pages?.token ? ` — made at ${appLinkHtml(s.key, 'token', { base })}` : '';
  return ` · token: the key <b>${escHtml(s.key)}</b> in <a href="#" onclick="nav('connectors');return false">Field → Connectors → API services</a>${made}`;
}

/** A suggested app: its release downloaded, checked and unpacked by the hub (mcp/craft-install.js), then added off. */
async function mcpCatalogInstall(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
  try {
    await apiFetch(`/api/mcp/catalog/${encodeURIComponent(id)}/install`, { method: 'POST' });
    await apiFetch(`/api/mcp/catalog/${encodeURIComponent(id)}`, { method: 'POST' });
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Install'; } return appAlert(e.message); }
  if (typeof mcpLoad === 'function') mcpLoad(); else mcpCatalogRender();
}

/** Every app of a kit not here yet, one at a time, each said as it goes. */
async function mcpCatalogKitAll(kit, btn) {
  const out = document.getElementById('mcp-kit-progress');
  btn.disabled = true;
  const servers = ((await apiFetch('/api/mcp/catalog')).servers || []).filter(s => s.kit === kit && !s.added);
  let done = 0;
  for (const s of servers) {
    out.textContent = `${s.label.split(' — ')[0]}… (${done + 1} of ${servers.length})`;
    try {
      if (s.installable && s.missing.length) await apiFetch(`/api/mcp/catalog/${encodeURIComponent(s.id)}/install`, { method: 'POST' });
      await apiFetch(`/api/mcp/catalog/${encodeURIComponent(s.id)}`, { method: 'POST' });
      done++;
    } catch (e) { out.textContent = `${s.label.split(' — ')[0]}: ${e.message}`; await new Promise(r => setTimeout(r, 2500)); }
  }
  out.textContent = `${done} of ${servers.length} added, off until started.`;
  if (typeof mcpLoad === 'function') mcpLoad(); else mcpCatalogRender();
}

/* MCP → Prepared by the agent (modules/mcp/drafts.js): servers the agent drafted for a person to add — any server, not
   only the catalogue's. A draft is not a server: "Open in the form" fills the ordinary add-server form with it, the
   person reads the exact command, pastes the secrets it names and presses Save. Dismiss forgets it. */
let _mcpDrafts = [];

async function mcpDraftsRender() {
  const list = document.getElementById('mcp-list');
  if (!list) return;
  try { _mcpDrafts = (await apiFetch('/api/mcp/drafts')).drafts || []; } catch { return; }
  document.getElementById('mcp-drafts')?.remove();
  if (!_mcpDrafts.length) return;
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'mcp-drafts' });
  card.innerHTML = `<div class="card-title">Prepared by the agent</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:6px">Not added yet: open one in the form, read what it would run, paste what it needs, and Save.</p>
    ${_mcpDrafts.map(d => `<div class="disk-row">
      <span class="disk-label">${escHtml(d.name)}</span>
      <span class="disk-path"><code>${escHtml(d.transport === 'http' ? d.url : [d.command, ...d.args].join(' '))}</code> · for ${escHtml(d.where)}${d.why ? ` — ${escHtml(d.why)}` : ''}</span>
      <span class="disk-free"><button class="btn btn-xs btn-blue" onclick="mcpDraftOpen(${jsArg(d.id)})">Open in the form</button>
        <button class="btn btn-xs" onclick="mcpDraftDismiss(${jsArg(d.id)})">Dismiss</button></span></div>`).join('')}`;
  list.prepend(card);
}

/** The draft in the add-server form: everything but the secrets, which it names. */
function mcpDraftOpen(id) {
  const d = _mcpDrafts.find(x => x.id === id);
  if (!d) return;
  mcpNew();
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  set('mcp-name', d.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
  set('mcp-transport', d.transport);
  mcpTransportChange();
  set('mcp-command', d.command); set('mcp-args', d.args.join('\n'));
  set('mcp-env', Object.entries(d.env).map(([k, v]) => `${k}=${v}`).join('\n'));
  set('mcp-url', d.url); set('mcp-headers', d.headers.map(h => `${h}: `).join('\n'));
  const empty = [...Object.entries(d.env).filter(([, v]) => v === '').map(([k]) => k), ...d.headers];
  setStatus(document.getElementById('mcp-form-status'), `Prepared by the agent for ${d.where}.${empty.length ? ` Fill ${empty.join(', ')}, then Save.` : ' Read it, then Save.'}`
    + `${/hub/i.test(d.where) ? '' : ' It drives a program on that machine: there, it is added through its DOCA client (DocaDesk or doca-client), or here as an http server it serves.'}`, '');
  document.getElementById('mcp-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function mcpDraftDismiss(id) {
  try { await apiFetch(`/api/mcp/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
  mcpDraftsRender();
}

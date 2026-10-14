/* ═══════════════════════════════════════════════════════
   Field → MCP → Software for a job (modules/mcp/software.js; R2b, the owner's answer of 2026-10-13): pick a job, see
   what people use for it — open or proprietary, side by side, each marked by what it is — with the way that fits
   here: Connect (it is here, or an account), Install (the panel installs it), Download (its maker's page). The
   choice is the person's; nothing is ticked or pushed, and the order is what is here first, then by name.
   ═══════════════════════════════════════════════════════ */

let _softwareJob = null;
try { _softwareJob = localStorage.getItem('doca.software.job'); } catch { /* per browser only */ }

async function mcpSoftwareRender() {
  const list = document.getElementById('mcp-list');
  if (!list) return;
  let d;
  try { d = await apiFetch(`/api/mcp/software?job=${encodeURIComponent(_softwareJob || 'documents')}`, { noAsk: true }); } catch { return; }
  let card = document.getElementById('mcp-software');
  if (!card) { card = Object.assign(document.createElement('div'), { className: 'card', id: 'mcp-software' }); list.append(card); }
  const job = d.job || 'documents';
  const MARK = { 'open source': 'open source', free: 'free', paid: 'paid', popular: 'popular' };
  const act = c => {
    if (c.state === 'connected') return '<span class="desc">✓ connected</span>';
    if (c.state === 'here') return '<span class="desc" title="Installed on the hub. DOCA has no way into it yet: the agent can still open files with it on this machine.">installed here</span>';
    if (c.state === 'connect' && c.mcp) return `<button class="btn btn-xs btn-teal" onclick="mcpCatalogAdd(${jsArg(c.mcp)}, 'stdio')">Connect</button>`;
    if (c.state === 'connect' && c.account && !licencePageOn('connectors')) return `<a class="btn btn-xs" href="${escHtml(c.site)}" target="_blank" rel="noopener noreferrer" title="Its maker's own page">Open ↗</a>`;   // no Connectors here (lib/licence.js)
    if (c.state === 'connect' && c.account) return `<button class="btn btn-xs btn-teal" onclick="nav('connectors')" title="Your own account, through Field → Connectors">Connect your account</button>`;
    if (c.state === 'install') return `<button class="btn btn-xs" onclick="mcpCatalogInstall(${jsArg(c.mcp)}, this)">Install</button>`;
    return `<a class="btn btn-xs" href="${escHtml(c.site)}" target="_blank" rel="noopener noreferrer" title="Its maker's own page">Download ↗</a>`;
  };
  card.innerHTML = `<div class="card-title">Software for a job</div>
    <p class="desc">What people use for it, open or proprietary, side by side. Pick what you like: here it connects, missing it installs or opens its maker's page.</p>
    <select class="input" id="mcp-software-job" onchange="mcpSoftwareJob(this.value)" style="max-width:320px;margin:6px 0 10px">
      ${d.jobs.map(j => `<option value="${escHtml(j.id)}"${j.id === job ? ' selected' : ''}>${escHtml(j.label)}</option>`).join('')}</select>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">
      ${d.choices.map(c => `<div class="cast-target" style="display:flex;flex-direction:column;gap:6px;align-items:stretch">
        <b>${escHtml(c.name)}</b>
        <span class="desc">${c.marks.map(m => escHtml(MARK[m] || m)).join(' · ')}</span>
        <span>${act(c)}</span></div>`).join('')}
    </div>`;
}

function mcpSoftwareJob(id) {
  _softwareJob = id;
  try { localStorage.setItem('doca.software.job', id); } catch { /* per browser only */ }
  mcpSoftwareRender();
}

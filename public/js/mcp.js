/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — MCP SERVERS
   ═══════════════════════════════════════════════════════ */

let _mcpTargets = [];
let _mcpOpenLog = null;   // id whose log is showing

function mcpInit() { mcpLoad(); }

async function mcpLoad() {
  const list = document.getElementById('mcp-list');
  if (!list) return;
  try {
    const data   = await apiFetch('/api/mcp');
    _mcpTargets  = data.targets || [];
    const servers = data.servers || [];
    list.innerHTML = servers.length
      ? servers.map(_mcpCardHtml).join('')
      : '<div class="placeholder">No MCP servers yet — add one below.</div>';
    _mcpExportRender(servers.length);
    if (_mcpOpenLog) mcpShowLog(_mcpOpenLog, true);
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function _mcpCardHtml(s) {
  const arg = jsArg(s.id);
  const running = s.state === 'running';
  const badge = { running: 'ok', starting: 'warn', error: 'no', stopped: '' }[s.state] || '';

  const where = s.transport === 'http'
    ? escHtml(s.url)
    : escHtml([s.command, ...(s.args || [])].join(' '));

  const tools = running && s.tools.length
    ? `<div class="mcp-tools">${s.tools.map(t =>
        `<span class="mcp-tool" title="${escHtml(t.description || '')}">${escHtml(t.name)}</span>`).join('')}</div>`
    : running
      ? '<div class="mcp-tools mcp-none">This server offers no tools.</div>'
      : '';

  return `
    <div class="card mb8 mcp-card mcp-${escHtml(s.state)}">
      <div class="toolbar" style="margin-bottom:6px">
        <span class="mcp-dot">${running ? '●' : '○'}</span>
        <div class="card-title" style="margin-bottom:0">${escHtml(s.label || s.id)}</div>
        <span class="provider-badge ${badge}">${escHtml(s.state.toUpperCase())}</span>
        ${running ? `<span class="mcp-count">${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}</span>` : ''}
        ${s.autostart ? '<span class="mcp-count">starts with DOCA</span>' : ''}
        <span style="flex:1"></span>
        ${running
          ? `<button class="btn btn-xs" onclick="mcpAction(${arg}, 'restart')">↻ Restart</button>
             <button class="btn btn-xs" onclick="mcpAction(${arg}, 'refresh')" title="Ask again which tools it has">↺ Tools</button>
             <button class="btn btn-xs" onclick="mcpAction(${arg}, 'stop')">Stop</button>`
          : `<button class="btn btn-xs btn-green" onclick="mcpAction(${arg}, 'start')">▶ Start</button>`}
        <button class="btn btn-xs" onclick="mcpShowLog(${arg})" title="What the server printed">Log</button>
        <button class="btn btn-xs" onclick="mcpEdit(${arg})">✎</button>
        <button class="btn btn-xs btn-red" onclick="mcpRemove(${arg})">✕</button>
      </div>
      <div class="mcp-where"><code>${where}</code></div>
      ${s.error ? `<div class="mcp-error">${escHtml(s.error)}</div>` : ''}
      ${tools}
      <pre class="code-out mcp-log" id="mcp-log-${escHtml(s.id)}" style="display:none"></pre>
      <div class="status-line mt4" id="mcp-status-${escHtml(s.id)}"></div>
    </div>`;
}

async function mcpAction(id, action) {
  const status = document.getElementById(`mcp-status-${id}`);
  setStatus(status, `${action}…`, '');
  try {
    const r = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action } });
    await mcpLoad();
    // A server that refuses to start answers 200 with the reason — its own log
    // is the useful part, so open it rather than making the user go looking.
    if (r.ok === false) {
      setStatus(document.getElementById(`mcp-status-${id}`), `✗ ${r.error}`, 'err');
      mcpShowLog(id, true);
    }
  } catch (e) {
    setStatus(document.getElementById(`mcp-status-${id}`) || status, `✗ ${e.message}`, 'err');
  }
}

async function mcpShowLog(id, keepOpen) {
  const pre = document.getElementById(`mcp-log-${id}`);
  if (!pre) return;
  if (!keepOpen && pre.style.display !== 'none') { pre.style.display = 'none'; _mcpOpenLog = null; return; }
  _mcpOpenLog = id;
  pre.style.display = 'block';
  try {
    const { log } = await apiFetch(`/api/mcp/${encodeURIComponent(id)}/log`);
    pre.textContent = log || '(nothing logged)';
    pre.scrollTop = pre.scrollHeight;
  } catch (e) { pre.textContent = e.message; }
}

function mcpRemove(id) {
  appConfirm(`Remove the "${id}" MCP server? It is stopped first if running.`, async () => {
    try {
      await apiFetch(`/api/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' });
      mcpLoad();
    } catch (e) { setStatus(document.getElementById(`mcp-status-${id}`), `✗ ${e.message}`, 'err'); }
  });
}

/* ── The add / edit form ─────────────────────────────── */

function mcpTransportChange() {
  const http = document.getElementById('mcp-transport').value === 'http';
  document.getElementById('mcp-stdio-fields').style.display = http ? 'none' : '';
  document.getElementById('mcp-http-fields').style.display  = http ? '' : 'none';
}

function mcpShowForm(show) {
  document.getElementById('mcp-form').style.display = show ? 'block' : 'none';
  if (!show) return;
  mcpTransportChange();
  document.getElementById('mcp-name').focus();
}

function mcpNew() {
  for (const [id, v] of Object.entries({
    'mcp-name': '', 'mcp-command': '', 'mcp-args': '', 'mcp-env': '', 'mcp-cwd': '', 'mcp-url': '',
  })) document.getElementById(id).value = v;
  document.getElementById('mcp-transport').value = 'stdio';
  document.getElementById('mcp-autostart').checked = false;
  document.getElementById('mcp-name').disabled = false;
  setStatus(document.getElementById('mcp-form-status'), '', '');
  mcpShowForm(true);
}

async function mcpEdit(id) {
  const { servers } = await apiFetch('/api/mcp');
  const s = servers.find(x => x.id === id);
  if (!s) return;
  document.getElementById('mcp-name').value      = s.label || s.id;
  document.getElementById('mcp-transport').value = s.transport;
  document.getElementById('mcp-command').value   = s.command || '';
  document.getElementById('mcp-args').value      = (s.args || []).join('\n');
  document.getElementById('mcp-env').value       = Object.entries(s.env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
  document.getElementById('mcp-cwd').value       = s.cwd || '';
  document.getElementById('mcp-url').value       = s.url || '';
  document.getElementById('mcp-autostart').checked = !!s.autostart;
  // The id is derived from the name and keys the definition, so renaming here
  // would create a second server rather than rename this one.
  document.getElementById('mcp-name').disabled = true;
  document.getElementById('mcp-name').dataset.editing = id;
  mcpShowForm(true);
}

async function mcpSave() {
  const status = document.getElementById('mcp-form-status');
  const nameEl = document.getElementById('mcp-name');
  const body = {
    id:        nameEl.disabled ? nameEl.dataset.editing : undefined,
    label:     nameEl.value.trim(),
    transport: document.getElementById('mcp-transport').value,
    command:   document.getElementById('mcp-command').value.trim(),
    args:      document.getElementById('mcp-args').value,
    env:       document.getElementById('mcp-env').value,
    cwd:       document.getElementById('mcp-cwd').value.trim(),
    url:       document.getElementById('mcp-url').value.trim(),
    autostart: document.getElementById('mcp-autostart').checked,
  };
  try {
    const r = await apiFetch('/api/mcp', { method: 'POST', body });
    setStatus(status, `✓ Saved ${r.server.id} — Start it to see its tools`, 'ok');
    nameEl.disabled = false;
    delete nameEl.dataset.editing;
    mcpShowForm(false);
    mcpLoad();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── Export to the other agents ──────────────────────── */

function _mcpExportRender(count) {
  const el = document.getElementById('mcp-export');
  if (!el) return;
  el.innerHTML = !count ? '' : `
    <div class="input-label" style="margin:10px 0 6px">
      Hand these servers to the other agents on this machine — the file's other settings are left alone
      and a <code>.bak</code> is kept.
    </div>
    <div class="provider-preset-row">
      ${_mcpTargets.map(t => `
        <button class="btn btn-xs" onclick="mcpExport(${jsArg(t.id)})"
                title="${escHtml(t.file)}${t.exists ? '' : ' (will be created)'}">
          ${escHtml(t.label)}${t.kind === 'toml' ? ' (snippet)' : ''}
        </button>`).join('')}
    </div>
    <div class="status-line mt4" id="mcp-export-status"></div>
    <pre class="code-out" id="mcp-export-snippet" style="display:none"></pre>`;
}

async function mcpExport(target) {
  const status  = document.getElementById('mcp-export-status');
  const snippet = document.getElementById('mcp-export-snippet');
  snippet.style.display = 'none';
  try {
    const r = await apiFetch('/api/mcp/export', { method: 'POST', body: { target } });
    setStatus(status, `${r.ok ? '✓' : 'ℹ'} ${r.message}`, r.ok ? 'ok' : 'warn');
    if (r.snippet) { snippet.textContent = r.snippet; snippet.style.display = 'block'; }
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

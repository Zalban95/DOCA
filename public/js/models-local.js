/* ═══════════════════════════════════════════════════════
   DOCA PANEL — MODELS: local non-LLM model files
   (split out of models.js; same globals, same tab)
   ═══════════════════════════════════════════════════════ */

/* ── Local Non-LLM Models ─────────────────────────────── */

function nlmInit() {
  nlmLoadSettings();
  nlmLoadList();
}

async function nlmLoadSettings() {
  const tool = document.getElementById('nlm-tool')?.value || 'whisper';
  try {
    const s = await apiFetch('/api/models/local/settings');
    const t = s[tool] || {};
    const pathEl    = document.getElementById('nlm-path');
    const apiUrlEl  = document.getElementById('nlm-apiurl');
    const cfgPathEl = document.getElementById('nlm-config-path');
    if (pathEl)    pathEl.value    = t.modelsPath  || '';
    if (apiUrlEl)  apiUrlEl.value  = t.apiUrl      || '';
    if (cfgPathEl) cfgPathEl.value = t.configPath  || '';
  } catch {}
}

async function nlmSaveSettings() {
  const tool   = document.getElementById('nlm-tool')?.value || 'whisper';
  const status = document.getElementById('nlm-settings-status');
  try {
    await apiFetch('/api/models/local/settings', {
      method: 'POST',
      body: {
        tool,
        modelsPath:  document.getElementById('nlm-path')?.value.trim()        || '',
        apiUrl:      document.getElementById('nlm-apiurl')?.value.trim()      || '',
        configPath:  document.getElementById('nlm-config-path')?.value.trim() || '',
      }
    });
    setStatus(status, '✓ Saved', 'ok');
    nlmLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function nlmConfigEdit() {
  const cfgPath = document.getElementById('nlm-config-path')?.value.trim();
  if (!cfgPath) return appAlert('No config file path set. Save a path first.');
  // Navigate to Files tab and open the file in the inline editor
  const dir = cfgPath.substring(0, cfgPath.lastIndexOf('/')) || '/';
  nav('files');
  setTimeout(() => {
    if (typeof fmNavigate === 'function') fmNavigate(dir);
    setTimeout(() => { if (typeof fmOpenEditor === 'function') fmOpenEditor(cfgPath); }, 400);
  }, 200);
}

async function nlmSearch() {
  const tool    = document.getElementById('nlm-tool')?.value || 'whisper';
  const q       = (document.getElementById('nlm-search-input')?.value || '').trim();
  const results = document.getElementById('nlm-search-results');
  if (!results) return;

  results.style.display = 'block';
  results.innerHTML = '<div class="placeholder pulse" style="padding:6px">Searching…</div>';

  try {
    const data = await apiFetch(`/api/models/local/search?tool=${tool}&q=${encodeURIComponent(q)}`);
    const list = data.results || [];
    if (!list.length) { results.innerHTML = '<div class="placeholder" style="padding:6px">No results</div>'; return; }
    results.innerHTML = '<div class="models-search-list">' + list.map(m => `
      <div class="models-search-item" onclick="nlmSearchSelect(${jsArg(m.name)})">
        <span class="models-search-name">${escHtml(m.name)}</span>
        <span class="models-search-desc">${escHtml(m.description || '')}</span>
      </div>
    `).join('') + '</div>';
  } catch (e) {
    results.innerHTML = `<div class="placeholder" style="color:var(--red);padding:6px">${e.message}</div>`;
  }
}

function nlmSearchSelect(name) {
  const input = document.getElementById('nlm-install-input');
  if (input) input.value = name;
  const results = document.getElementById('nlm-search-results');
  if (results) results.style.display = 'none';
}

async function nlmLoadList() {
  const tool  = document.getElementById('nlm-tool')?.value || 'whisper';
  const tbody = document.getElementById('nlm-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data   = await apiFetch(`/api/models/local/list?tool=${tool}`);
    const models = data.models || [];
    if (!models.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="placeholder" style="padding:12px">No models found for this tool</td></tr>';
      return;
    }
    tbody.innerHTML = models.map(m => `
      <tr class="models-row">
        <td class="models-name">${escHtml(m.name)}</td>
        <td style="font-size:10px;color:var(--muted);max-width:240px">${escHtml(m.description || '—')}</td>
        <td>
          <span class="badge ${m.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px">
            ${m.detected ? '● Installed' : '○ Not installed'}
          </span>
        </td>
        <td class="models-acts">
          ${m.detected
            ? `<button class="btn btn-xs btn-red" onclick="nlmDelete(${jsArg(tool)},${jsArg(m.name)})">✕ Remove</button>`
            : `<button class="btn btn-xs btn-teal" onclick="document.getElementById('nlm-install-input').value=${jsArg(m.name)};nlmInstall()">⬇ Install</button>`
          }
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:12px;color:var(--red)">${e.message}</td></tr>`;
  }
}

function nlmInstall() {
  const tool  = document.getElementById('nlm-tool')?.value || 'whisper';
  const model = document.getElementById('nlm-install-input')?.value.trim();
  if (!model) return;

  const out     = document.getElementById('nlm-install-out');
  const bar     = document.getElementById('nlm-pull-bar');
  const barFill = document.getElementById('nlm-pull-bar-fill');
  const pct     = document.getElementById('nlm-pull-pct');

  if (out) { out.style.display = 'block'; out.textContent = `Installing ${model}…\n`; }
  if (bar) { bar.style.display = 'block'; }
  if (barFill) barFill.style.width = '0%';
  if (pct) pct.textContent = '';

  sseStream('/api/models/local/install', { tool, model }, {
    onStatus: text => appendStream(out, text + '\n'),
    onDone: () => {
      if (bar) bar.style.display = 'none';
      if (pct) pct.textContent = '';
      nlmLoadList();
      modelsLoadDisk(true);
    },
    onError: e => { if (out) out.textContent += `Error: ${e.message}\n`; },
  }).then(nlmLoadList);
}

function nlmDelete(tool, model) {
  appConfirm(`Remove ${model} from ${tool}?`, async () => {
    try {
      await apiFetch('/api/models/local/delete', { method: 'POST', body: { tool, model } });
      nlmLoadList();
      modelsLoadDisk(true);
    } catch (e) { appAlert(`Delete error: ${e.message}`); }
  });
}

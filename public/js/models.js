/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — MODELS (Ollama + non-LLM tools)
   ═══════════════════════════════════════════════════════ */

let modelsOllamaConnected = false;

async function modelsInit() {
  await modelsLoadSettings();
  modelsCheckOllama();
  modelsLoadList();
  nlmInit();
  hfInit();
  if (typeof llamaInit === 'function') llamaInit();
  if (typeof servicesInit === 'function') servicesInit();
}

/* ── Settings ─────────────────────────────────────────── */
async function modelsLoadSettings() {
  try {
    const s = await apiFetch('/api/models/settings');
    document.getElementById('models-ollama-url').value   = s.ollamaUrl   || 'http://127.0.0.1:11434';
    document.getElementById('models-ollama-path').value  = s.ollamaPath  || '';
  } catch {}
}

async function modelsSaveSettings() {
  const status = document.getElementById('models-settings-status');
  try {
    const current = await apiFetch('/api/models/settings');
    await apiFetch('/api/models/settings', {
      method: 'POST',
      body: {
        ...current,
        ollamaUrl:  document.getElementById('models-ollama-url').value.trim(),
        ollamaPath: document.getElementById('models-ollama-path').value.trim(),
      }
    });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 3000);
    modelsCheckOllama();
    modelsLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── Ollama status ────────────────────────────────────── */
async function modelsCheckOllama() {
  const badge = document.getElementById('models-ollama-badge');
  badge.textContent = '…'; badge.className = 'badge badge-blue';
  try {
    const s = await apiFetch('/api/models/ollama/status');
    modelsOllamaConnected = s.connected;
    if (s.connected) {
      badge.textContent = `● Connected  v${s.version}`;
      badge.className   = 'badge badge-green';
    } else {
      badge.textContent = `○ Unreachable`;
      badge.className   = 'badge badge-red';
    }
  } catch {
    badge.textContent = '○ Error'; badge.className = 'badge badge-red';
  }
}

/* ── Installed models list ────────────────────────────── */
async function modelsLoadList() {
  const tbody = document.getElementById('models-table-body');
  tbody.innerHTML = '<tr><td colspan="4" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/models/ollama/list');
    const models = data.models || [];
    if (!models.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="placeholder" style="padding:12px">No models installed</td></tr>';
      return;
    }
    tbody.innerHTML = models.map(m => {
      const size    = m.size ? fmtBytes(m.size) : '—';
      const modified = m.modified_at ? fmtDate(m.modified_at) : '—';
      return `<tr class="models-row">
        <td class="models-name">${m.name}</td>
        <td class="models-size">${size}</td>
        <td class="models-date">${modified}</td>
        <td class="models-acts">
          <button class="btn btn-xs btn-red" onclick="modelsDelete('${m.name}')">✕ Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:12px;color:var(--red)">${e.message}</td></tr>`;
  }
}

/* ── Online search ────────────────────────────────────── */
async function modelsSearchOnline() {
  const q       = (document.getElementById('models-search-input')?.value || '').trim();
  const results = document.getElementById('models-search-results');
  if (!results) return;

  results.style.display = 'block';
  results.innerHTML = '<div class="placeholder pulse" style="padding:6px">Searching…</div>';

  try {
    const data = await apiFetch(`/api/models/ollama/search?q=${encodeURIComponent(q)}`);
    const list = data.results || [];
    if (!list.length) { results.innerHTML = '<div class="placeholder" style="padding:6px">No results</div>'; return; }
    results.innerHTML = '<div class="models-search-list">' + list.map(m => `
      <div class="models-search-item" onclick="modelsSearchSelect('${m.name.replace(/'/g,"\\'")}')">
        <span class="models-search-name">${m.name}</span>
        <span class="models-search-desc">${m.description || ''}</span>
        ${m.pulls ? `<span class="models-search-pulls" style="font-size:9px;color:var(--muted)">${fmtNumber(m.pulls)} pulls</span>` : ''}
      </div>
    `).join('') + '</div>';
  } catch (e) {
    results.innerHTML = `<div class="placeholder" style="color:var(--red);padding:6px">${e.message}</div>`;
  }
}

function modelsSearchSelect(name) {
  const input = document.getElementById('models-pull-input');
  if (input) input.value = name;
  const results = document.getElementById('models-search-results');
  if (results) results.style.display = 'none';
}

function fmtNumber(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/* ── Pull model ───────────────────────────────────────── */
function modelsPull() {
  const name = document.getElementById('models-pull-input').value.trim();
  if (!name) return;
  const out     = document.getElementById('models-pull-out');
  const bar     = document.getElementById('models-pull-bar');
  const barFill = document.getElementById('models-pull-bar-fill');
  const pct     = document.getElementById('models-pull-pct');

  out.style.display = 'block';
  out.textContent   = `Pulling ${name}…\n`;
  bar.style.display = 'block';
  barFill.style.width = '0%';
  pct.textContent     = '';

  fetch('/api/models/ollama/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) { modelsLoadList(); return; }
        decoder.decode(value).split('\n').forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.status)   out.textContent += obj.status + '\n';
            if (obj.total && obj.completed) {
              const p = Math.round(obj.completed / obj.total * 100);
              barFill.style.width = p + '%';
              pct.textContent     = p + '%';
            }
            if (obj.done) {
              bar.style.display = 'none';
              pct.textContent   = '';
              if (!obj.error) out.textContent += '✓ Done\n';
            }
          } catch {}
        });
        out.scrollTop = out.scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => { out.textContent += `Error: ${e.message}\n`; });
}

/* ── Delete model ─────────────────────────────────────── */
function modelsDelete(name) {
  appConfirm(`Delete model: ${name}?`, async () => {
    try {
      await apiFetch('/api/models/ollama/delete', { method: 'POST', body: { name } });
      modelsLoadList();
    } catch (e) { alert(`Delete error: ${e.message}`); }
  });
}

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
    setTimeout(() => setStatus(status, ''), 3000);
    nlmLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function nlmConfigEdit() {
  const cfgPath = document.getElementById('nlm-config-path')?.value.trim();
  if (!cfgPath) return alert('No config file path set. Save a path first.');
  // Navigate to Files tab and open the file in the inline editor
  const dir = cfgPath.substring(0, cfgPath.lastIndexOf('/')) || '/';
  document.querySelector('[data-tab="files"]')?.click();
  setTimeout(() => {
    if (typeof _fpNav === 'function') _fpNav(dir);
    if (typeof fmOpenEditor === 'function') fmOpenEditor(cfgPath);
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
      <div class="models-search-item" onclick="nlmSearchSelect('${m.name.replace(/'/g,"\\'")}')">
        <span class="models-search-name">${m.name}</span>
        <span class="models-search-desc">${m.description || ''}</span>
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
        <td class="models-name">${m.name}</td>
        <td style="font-size:10px;color:var(--muted);max-width:240px">${m.description || '—'}</td>
        <td>
          <span class="badge ${m.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px">
            ${m.detected ? '● Installed' : '○ Not installed'}
          </span>
        </td>
        <td class="models-acts">
          ${m.detected
            ? `<button class="btn btn-xs btn-red" onclick="nlmDelete('${tool}','${m.name}')">✕ Remove</button>`
            : `<button class="btn btn-xs btn-teal" onclick="document.getElementById('nlm-install-input').value='${m.name}';nlmInstall()">⬇ Install</button>`
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

  fetch('/api/models/local/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, model })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) { nlmLoadList(); return; }
        decoder.decode(value).split('\n').forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj.status && out) out.textContent += obj.status + '\n';
            if (obj.done) {
              if (bar) bar.style.display = 'none';
              if (pct) pct.textContent = '';
              nlmLoadList();
            }
          } catch {}
        });
        if (out) out.scrollTop = out.scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => { if (out) out.textContent += `Error: ${e.message}\n`; });
}

function nlmDelete(tool, model) {
  appConfirm(`Remove ${model} from ${tool}?`, async () => {
    try {
      await apiFetch('/api/models/local/delete', { method: 'POST', body: { tool, model } });
      nlmLoadList();
    } catch (e) { alert(`Delete error: ${e.message}`); }
  });
}

/* ══════════════════════════════════════════════════════════
   HuggingFace Models
   ══════════════════════════════════════════════════════════ */

function hfInit() {
  hfLoadSettings();
  hfCheckStatus();
  hfLoadList();
}

async function hfLoadSettings() {
  try {
    const s = await apiFetch('/api/models/hf/settings');
    const cacheEl = document.getElementById('hf-cache-dir');
    const tokenEl = document.getElementById('hf-token');
    if (cacheEl) cacheEl.value = s.cacheDir || '';
    if (tokenEl) tokenEl.value = s.token    || '';
  } catch {}
}

async function hfSaveSettings() {
  const status   = document.getElementById('hf-settings-status');
  const cacheDir = document.getElementById('hf-cache-dir')?.value.trim() || '';
  const token    = document.getElementById('hf-token')?.value.trim()    || '';
  try {
    await apiFetch('/api/models/hf/settings', { method: 'POST', body: { cacheDir, token } });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 3000);
    hfCheckStatus();
    hfLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

async function hfCheckStatus() {
  const badge = document.getElementById('hf-status-badge');
  if (!badge) return;
  badge.textContent = '…'; badge.className = 'badge badge-blue';
  try {
    const s = await apiFetch('/api/models/hf/status');
    if (s.detected) {
      const label = s.user ? `● ${s.user}  v${s.version}` : `● CLI v${s.version}`;
      badge.textContent = label;
      badge.className   = 'badge badge-green';
    } else {
      badge.textContent = '○ huggingface-cli not found';
      badge.className   = 'badge badge-red';
    }
  } catch {
    badge.textContent = '○ Error'; badge.className = 'badge badge-red';
  }
}

async function hfSearch() {
  const q = document.getElementById('hf-search-input')?.value.trim();
  if (!q) return;
  const box = document.getElementById('hf-search-results');
  if (box) { box.style.display = 'block'; box.innerHTML = '<div class="placeholder pulse" style="padding:8px">Searching…</div>'; }
  try {
    const data    = await apiFetch(`/api/models/hf/search?q=${encodeURIComponent(q)}`);
    const results = data.results || [];
    if (!results.length) {
      if (box) box.innerHTML = '<div class="placeholder" style="padding:8px">No results</div>';
      return;
    }
    if (box) box.innerHTML = results.map(m => `
      <div class="models-search-item" onclick="hfSearchSelect('${m.id.replace(/'/g,"\\'")}')">
        <span class="models-search-name">${m.id}</span>
        <span class="models-search-desc">${m.pipeline_tag ? m.pipeline_tag + '  ·  ' : ''}⬇ ${fmtNumber(m.downloads)}  ♥ ${fmtNumber(m.likes)}</span>
      </div>`).join('');
  } catch (e) {
    if (box) box.innerHTML = `<div class="placeholder" style="color:var(--red);padding:8px">${e.message}</div>`;
  }
}

function hfSearchSelect(repoId) {
  const inp = document.getElementById('hf-dl-input');
  if (inp) inp.value = repoId;
  const box = document.getElementById('hf-search-results');
  if (box) box.style.display = 'none';
}

async function hfLoadList() {
  const tbody = document.getElementById('hf-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data  = await apiFetch('/api/models/hf/list');
    const repos = data.repos || [];
    if (!repos.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder" style="padding:12px">No cached models found</td></tr>';
      return;
    }
    tbody.innerHTML = repos.map(r => {
      const size   = r.size_on_disk ? fmtBytes(r.size_on_disk) : '—';
      const date   = r.last_modified ? fmtDate(r.last_modified) : '—';
      const safe   = r.repo_id.replace(/'/g, "\\'");
      const parts  = r.repo_id.split('/');
      const org    = parts.length > 1 ? parts[0] : '';
      const name   = parts.length > 1 ? parts.slice(1).join('/') : r.repo_id;
      return `<tr class="models-row">
        <td class="models-name" title="${r.repo_id}">
          ${org ? `<span style="opacity:.5;font-size:10px">${org}/</span>` : ''}${name}
        </td>
        <td class="models-size">${r.repo_type || 'model'}</td>
        <td class="models-size">${size}</td>
        <td class="models-date">${date}</td>
        <td class="models-acts">
          <button class="btn btn-xs btn-red" onclick="hfDelete('${safe}')">✕ Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--red)">${e.message}</td></tr>`;
  }
}

function hfDownload() {
  const repoId = document.getElementById('hf-dl-input')?.value.trim();
  if (!repoId) return;

  const out    = document.getElementById('hf-dl-out');
  const bar    = document.getElementById('hf-pull-bar');
  const barFil = document.getElementById('hf-pull-bar-fill');
  const pct    = document.getElementById('hf-pull-pct');

  if (out)    { out.style.display = 'block'; out.textContent = ''; }
  if (bar)    bar.style.display = 'block';
  if (barFil) barFil.style.width = '0%';
  if (pct)    pct.textContent = '';

  fetch('/api/models/hf/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId }),
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    const read = () => reader.read().then(({ done, value }) => {
      if (done) { if (bar) bar.style.display = 'none'; return; }
      decoder.decode(value).split('\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.status) {
            if (out) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
            // Parse tqdm percentage from CLI output (e.g. "  5%|▌| 248M/4.67G")
            const pctMatches = obj.status.match(/(\d+)%/g);
            if (pctMatches) {
              const p = parseInt(pctMatches[pctMatches.length - 1]);
              if (barFil) barFil.style.width = `${p}%`;
              if (pct)    pct.textContent    = `${p}%`;
            }
          }
          if (obj.done) {
            if (bar)  bar.style.display = 'none';
            if (pct)  pct.textContent = '';
            setTimeout(hfLoadList, 1000);
          }
        } catch {}
      });
      read();
    });
    read();
  }).catch(e => { if (out) out.textContent += `Error: ${e.message}\n`; });
}

function hfDelete(repoId) {
  appConfirm(`Delete cached model: ${repoId}?`, async () => {
    try {
      await apiFetch('/api/models/hf/delete', { method: 'POST', body: { repoId } });
      hfLoadList();
    } catch (e) { alert(`Delete error: ${e.message}`); }
  });
}

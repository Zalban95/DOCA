/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — MODELS (Ollama + non-LLM tools)
   ═══════════════════════════════════════════════════════ */

let modelsOllamaConnected = false;

async function modelsInit() {
  await modelsLoadSettings();
  modelsCheckOllama();
  modelsLoadList();
  nlmInit();
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
    const pathEl   = document.getElementById('nlm-path');
    const apiUrlEl = document.getElementById('nlm-apiurl');
    if (pathEl)   pathEl.value   = t.modelsPath || '';
    if (apiUrlEl) apiUrlEl.value = t.apiUrl     || '';
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
        modelsPath: document.getElementById('nlm-path')?.value.trim()   || '',
        apiUrl:     document.getElementById('nlm-apiurl')?.value.trim() || '',
      }
    });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 3000);
    nlmLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
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

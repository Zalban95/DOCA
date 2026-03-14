/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — MODELS (Ollama + non-LLM tools)
   ═══════════════════════════════════════════════════════ */

let modelsOllamaConnected = false;

async function modelsInit() {
  await modelsLoadSettings();
  modelsCheckOllama();
  modelsLoadList();
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

/* ── Non-LLM tools ────────────────────────────────────── */
async function modelsLoadTools() {
  const container = document.getElementById('models-tools-list');
  container.innerHTML = '<div class="placeholder pulse" style="padding:12px">Detecting tools…</div>';
  try {
    const data  = await apiFetch('/api/models/tools');
    const tools = data.tools || [];
    if (!tools.length) {
      container.innerHTML = '<div class="placeholder">No tools configured</div>';
      return;
    }
    container.innerHTML = tools.map(t => `
      <div class="models-tool-row" id="tool-row-${t.id}">
        <div class="models-tool-info">
          <span class="models-tool-name">${t.label}</span>
          <span class="badge ${t.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px">
            ${t.detected ? '● Detected' : '○ Not found'}
          </span>
          <span class="badge models-type-badge">${t.type.toUpperCase()}</span>
        </div>
        <div class="models-tool-config">
          <input class="input" placeholder="Custom path (leave blank to auto-detect)"
                 id="tool-path-${t.id}" value="${t.path || ''}" style="width:200px">
          <label class="skill-toggle" title="Available to OpenClaw" style="display:inline-flex;align-items:center;gap:6px;width:auto">
            <input type="checkbox" id="tool-avail-${t.id}" ${t.availableForOpenclaw ? 'checked' : ''}>
            <span class="skill-toggle-track"></span>
            <span style="font-size:10px;color:var(--muted)">OpenClaw</span>
          </label>
          <button class="btn btn-xs" onclick="modelsToolSave('${t.id}')">Save</button>
          <a class="btn btn-xs" onclick="nav('keys');setTimeout(keysShowToolApis,200)" style="cursor:pointer;font-size:9px">API →</a>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

async function modelsToolSave(id) {
  const pathEl   = document.getElementById(`tool-path-${id}`);
  const apiUrlEl = document.getElementById(`tool-apiurl-${id}`);
  const availEl  = document.getElementById(`tool-avail-${id}`);
  try {
    await apiFetch(`/api/models/tools/${id}/config`, {
      method: 'POST',
      body: {
        path:      pathEl   ? pathEl.value.trim()   : '',
        apiUrl:    apiUrlEl ? apiUrlEl.value.trim() : '',
        available: availEl  ? availEl.checked       : false,
      }
    });
    modelsLoadTools();
  } catch (e) { alert(`Save error: ${e.message}`); }
}

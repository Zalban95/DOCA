/* ═══════════════════════════════════════════════════════
   DOCA PANEL — MODELS: Ollama, storage and settings (AI tools, local files
   and HuggingFace are models-ai-tools.js, models-local.js, models-hf.js)
   ═══════════════════════════════════════════════════════ */

let modelsOllamaConnected = false;

async function modelsInit() {
  await modelsLoadSettings();
  modelsLoadDisk();
  modelsCheckOllama();
  modelsLoadList();
  aiToolsLoad();
  hfInit();
  if (typeof llamaInit === 'function') llamaInit();
  if (typeof servicesInit === 'function') servicesInit();
}

/* ── Storage overview ─────────────────────────────────── */

async function modelsLoadDisk(force = false) {
  const strip = document.getElementById('models-disk-strip');
  if (!strip) return;
  try {
    const data  = await apiFetch(`/api/models/disk${force ? '?force=1' : ''}`);
    const disks = data.disks || [];
    if (!disks.length) { strip.innerHTML = '<div class="placeholder">No model directories found</div>'; return; }

    strip.innerHTML = disks.map(d => {
      if (!d.exists) {
        return `<div class="disk-row">
          <span class="disk-label">${escHtml(d.label)}</span>
          <span class="disk-path" title="${escHtml(d.path)}">${escHtml(d.path)}</span>
          <span class="disk-free placeholder">not present yet</span>
        </div>`;
      }
      const pct   = d.pct ?? 0;
      const color = pct > 90 ? 'red' : pct > 70 ? 'amber' : 'green';
      const size  = d.dirSizeKB != null ? fmtBytes(d.dirSizeKB * 1024) : '—';
      const free  = d.availKB  != null ? fmtBytes(d.availKB * 1024)  : '—';
      const total = d.totalKB  != null ? fmtBytes(d.totalKB * 1024)  : '—';
      return `<div class="disk-row">
        <span class="disk-label">${escHtml(d.label)}</span>
        <span class="disk-path" title="${escHtml(d.path)}${d.mount ? ` (mount ${escHtml(d.mount)})` : ''}">${escHtml(d.path)}</span>
        <span class="disk-size" title="${d.inside ? `Size of this directory — part of ${escHtml(d.inside)}'s, not added to it` : 'Size of this directory'}">◆ ${size}${d.inside ? ' <span style="color:var(--muted)">within</span>' : ''}</span>
        <div class="res-bar disk-bar" title="Drive usage ${pct}%"><div class="res-bar-fill ${color}" style="width:${pct}%"></div></div>
        <span class="disk-free" title="Free space on this drive">${free} free of ${total}</span>
      </div>`;
    }).join('');
  } catch (e) {
    strip.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
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
    } else if (s.code === 'ollama_unreachable') {
      // Not installed or not running is a state of the machine, not a fault: said so, the address in the tooltip.
      badge.textContent = '○ Not installed or not running';
      badge.className   = 'badge badge-amber';
      badge.title       = `${s.reason} (looked at ${s.url})`;
    } else {
      badge.textContent = `○ Unreachable`;
      badge.className   = 'badge badge-red';
      badge.title       = `${s.error || ''} (${s.url})`;
    }
  } catch {
    modelsOllamaConnected = false;
    badge.textContent = '○ Error'; badge.className = 'badge badge-red';
  }
  _modelsOllamaInstallBtn();
}

/** Show an install button when Ollama is unreachable and the binary is missing. */
async function _modelsOllamaInstallBtn() {
  const btn = document.getElementById('models-ollama-install-btn');
  if (!btn) return;
  if (modelsOllamaConnected) { btn.style.display = 'none'; return; }
  try {
    const tools = await getSystemTools();
    const t = tools.find(x => x.id === 'ollama');
    btn.style.display = t && !t.detected && t.canInstall ? '' : 'none';
  } catch { btn.style.display = 'none'; }
}

function modelsInstallOllama() {
  const out = document.getElementById('models-ollama-out');
  systemToolInstall('ollama', out, () => setTimeout(() => { modelsCheckOllama(); modelsLoadList(); }, 1000));
}

/* ── Installed models list ────────────────────────────── */
async function modelsLoadList() {
  const tbody = document.getElementById('models-table-body');
  tbody.innerHTML = '<tr><td colspan="4" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/models/ollama/list');
    const models = data.models || [];
    const totalEl = document.getElementById('models-ollama-total');
    if (totalEl) {
      const totalBytes = models.reduce((s, m) => s + (m.size || 0), 0);
      totalEl.textContent = models.length ? `· ${models.length} model${models.length > 1 ? 's' : ''} · ${fmtBytes(totalBytes)} on disk` : '';
    }
    if (!models.length) {
      // Ollama not installed or not running is an empty list with its reason (a 200), drawn as a state in plain
      // words, the way to System tools, and the address it looked at on a detail line (self-test 2026-10-08, #11).
      tbody.innerHTML = data.reason
        ? `<tr><td colspan="4" class="placeholder" style="padding:12px">Ollama is not installed or not running on this machine.
            <button class="btn btn-xs" onclick="nav('settings');settingsSubNav('system')">Settings → System → System tools</button>
            <div style="margin-top:4px;font-size:11px;color:var(--muted);word-break:break-all">Looked for it at ${escHtml(data.url || '')}</div></td></tr>`
        : '<tr><td colspan="4" class="placeholder" style="padding:12px">No models installed</td></tr>';
      return;
    }
    tbody.innerHTML = models.map(m => {
      const size    = m.size ? fmtBytes(m.size) : '—';
      const modified = m.modified_at ? fmtDate(m.modified_at) : '—';
      return `<tr class="models-row">
        <td class="models-name">${escHtml(m.name)}</td>
        <td class="models-size">${escHtml(size)}</td>
        <td class="models-date">${escHtml(modified)}</td>
        <td class="models-acts">
          <button class="btn btn-xs btn-red" onclick="modelsDelete(${jsArg(m.name)})">✕ Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:12px;color:var(--red)">${escHtml(e.message)}</td></tr>`;
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
      <div class="models-search-item" onclick="modelsSearchSelect(${jsArg(m.name)})">
        <span class="models-search-name">${escHtml(m.name)}</span>
        <span class="models-search-desc">${escHtml(m.description || '')}</span>
        ${m.pulls ? `<span class="models-search-pulls" style="font-size:9px;color:var(--muted)">${fmtNumber(m.pulls)} pulls</span>` : ''}
        ${m.tags?.length ? `<span style="font-size:9px;color:var(--muted)" title="What it can do, and the sizes it comes in (pull name:size)">${escHtml(m.tags.join(' · '))}</span>` : ''}
      </div>
    `).join('') + '</div>';
  } catch (e) {
    results.innerHTML = `<div class="placeholder" style="color:var(--red);padding:6px">${escHtml(e.message)}</div>`;
  }
}

function modelsSearchSelect(name) {
  const input = document.getElementById('models-pull-input');
  if (input) input.value = name;
  const results = document.getElementById('models-search-results');
  if (results) results.style.display = 'none';
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

  sseStream('/api/models/ollama/pull', { name }, {
    onEvent: obj => {
      if (obj.status) appendStream(out, obj.status + '\n');
      if (obj.total && obj.completed) {
        const p = Math.round(obj.completed / obj.total * 100);
        barFill.style.width = p + '%';
        // Track the actual bytes downloaded, not just the percentage
        pct.textContent = `${p}% · ${fmtBytes(obj.completed)} / ${fmtBytes(obj.total)}`;
      }
      if (obj.done) {
        bar.style.display = 'none';
        pct.textContent   = '';
        if (!obj.error) appendStream(out, '✓ Done\n');
      }
    },
    onError: e => { out.textContent += `Error: ${e.message}\n`; },
  }).then(() => { modelsLoadList(); modelsLoadDisk(true); });
}

/* ── Delete model ─────────────────────────────────────── */
function modelsDelete(name) {
  appConfirm(`Delete the model “${name}” from Ollama? Its files go from the disk; anything set to use it stops answering until it is pulled again.`, async () => {
    try {
      await apiFetch('/api/models/ollama/delete', { method: 'POST', body: { name } });
      modelsLoadList();
      modelsLoadDisk(true);
    } catch (e) { appAlert(`Delete error: ${e.message}`); }
  });
}

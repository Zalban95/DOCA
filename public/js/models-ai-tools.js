/* ═══════════════════════════════════════════════════════
   DOCA PANEL — MODELS: AI tools (STT · TTS · image)
   (split out of models.js; same globals, same tab)
   ═══════════════════════════════════════════════════════ */

/* ── AI Tools (STT · TTS · Image) ─────────────────────── */

let _aiTools = [];

async function aiToolsLoad() {
  const list = document.getElementById('ai-tools-list');
  const btn  = document.getElementById('ai-tools-refresh-btn');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Checking…</div>';
  if (btn) btn.disabled = true;
  try {
    const data = await apiFetch('/api/models/tools');
    _aiTools = data.tools || [];
    _aiToolsRender();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _aiToolsRender() {
  const list = document.getElementById('ai-tools-list');
  if (!list) return;
  if (!_aiTools.length) { list.innerHTML = '<div class="placeholder">No tools defined</div>'; return; }

  const typeLabel = { stt: 'STT', tts: 'TTS', image: 'IMAGE' };

  list.innerHTML = _aiTools.map(t => {
    // API tools that map to an inference service get a "Start via Services" action
    const serviceBtn = !t.detected && t.serviceId
      ? `<button class="btn btn-xs btn-purple" title="Run via Inference Services"
                 onclick="aiToolGoService()">▶ via Services</button>`
      : '';
    const availBadge = t.detected && t.availableForOpenclaw
      ? `<span class="badge badge-green" style="font-size:9px">agent ✓</span>` : '';

    const row = toolRowHtml({
      id:             `ai-${t.id}`,
      label:          `${t.label}`,
      note:           `${typeLabel[t.type] || ''} — ${t.note || ''}`,
      detected:       t.detected,
      version:        t.detected ? (t.isApi ? t.apiUrl : t.path) : null,
      canInstall:     t.canInstall,
      installOnclick: `aiToolInstall('${t.id}')`,
      gearOnclick:    `aiToolGearToggle('${t.id}')`,
      extraActions:   `${availBadge}${serviceBtn}`,
    });

    // Inline config strip (hidden until the gear is clicked)
    const strip = `
      <div class="tool-config-strip" id="ai-tool-cfg-${t.id}" style="display:none">
        ${t.isApi ? `
          <span class="input-label">API URL</span>
          <input class="input flex1" id="ai-tool-apiurl-${t.id}" value="${escHtml(t.apiUrl || '')}"
                 placeholder="http://localhost:8880">
        ` : `
          <span class="input-label">Binary path</span>
          <input class="input flex1" id="ai-tool-path-${t.id}" value="${escHtml(t.path || '')}"
                 placeholder="auto-detected if empty">
          <button class="btn btn-xs" title="Browse" onclick="fpOpen('ai-tool-path-${t.id}','file')">📁</button>
        `}
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)">
          <input type="checkbox" id="ai-tool-avail-${t.id}" ${t.availableForOpenclaw ? 'checked' : ''}>
          Available to agent
        </label>
        <button class="btn btn-xs btn-blue" onclick="aiToolConfigSave('${t.id}')">Save</button>
      </div>`;

    return row + strip;
  }).join('');
}

function aiToolGearToggle(id) {
  const strip = document.getElementById(`ai-tool-cfg-${id}`);
  if (strip) strip.style.display = strip.style.display === 'none' ? 'flex' : 'none';
}

async function aiToolConfigSave(id) {
  const tool = _aiTools.find(t => t.id === id);
  if (!tool) return;
  const body = {
    path:      document.getElementById(`ai-tool-path-${id}`)?.value.trim()   || '',
    apiUrl:    document.getElementById(`ai-tool-apiurl-${id}`)?.value.trim() || '',
    available: document.getElementById(`ai-tool-avail-${id}`)?.checked ?? true,
  };
  try {
    await apiFetch(`/api/models/tools/${id}/config`, { method: 'POST', body });
    aiToolsLoad(); // re-detect with the new config
  } catch (e) { appAlert(`Save error: ${e.message}`); }
}

async function aiToolInstall(id) {
  const out = document.getElementById('ai-tools-out');
  showStream(out, `Installing ${id}…\n`);
  await sseStream(`/api/models/tools/${id}/install`, { id }, {
    onStatus: text => appendStream(out, text),
    onDone:   () => setTimeout(aiToolsLoad, 800),
    onError:  e => { if (out) out.textContent += `\nError: ${e.message}`; },
  });
}

/** Scroll to the Inference Services card (services start the API tools). */
function aiToolGoService() {
  const grid = document.getElementById('services-grid');
  // Without Docker the services cannot start, and scrolling to them said nothing (deep test B, R4).
  if (!grid || /docker|not found|ENOENT|unavailable/i.test(grid.textContent) && !grid.querySelector('button'))
    return appAlert('This runs as an inference service, which needs Docker (or Podman) on this machine. Settings → System → System tools installs it; then ▶ Start it under Inference Services below.');
  grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

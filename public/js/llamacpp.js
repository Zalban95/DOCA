/* ═══════════════════════════════════════════════════════
   DOCA PANEL — LLAMA.CPP SERVER MANAGEMENT
   Manages native llama-server processes with configurable
   model, port, GPU layers, and context size.
   ═══════════════════════════════════════════════════════ */

let _llamaInstances = [];
let _llamaStatus    = {};

async function llamaInit() {
  await llamaLoadList();
  _llamaServerBadge();
  llamaHfCard();   // From Hugging Face (llamacpp-hf.js)
}

/** Detect the llama-server binary (shared system-tools check) and badge it. */
async function _llamaServerBadge() {
  const badge = document.getElementById('llama-server-badge');
  if (!badge) return;
  try {
    const tools = await getSystemTools();
    const t = tools.find(x => x.id === 'llama-server');
    if (!t) return;
    badge.style.display = '';
    if (t.detected) {
      badge.textContent = '✓ llama-server';
      badge.className   = 'badge badge-green';
    } else {
      badge.innerHTML   = `✗ llama-server missing — <a href="${t.repo}" target="_blank" style="color:inherit;text-decoration:underline">get binary</a>`;
      badge.className   = 'badge badge-red';
    }
    badge.style.fontSize = '9px';
  } catch {}
}

async function llamaLoadList() {
  try {
    const data = await apiFetch('/api/models/llamacpp/list');
    _llamaInstances = data.instances || [];
    _llamaRenderExternal(data.external || [], data.via || 'servers');
  } catch { _llamaInstances = []; }
  _renderLlamaGrid();
}

/** llama-servers running without the panel — found through the harness's local providers. Shown, not managed. */
function _llamaRenderExternal(list, via = 'servers') {
  const grid = document.getElementById('llamacpp-grid');
  if (!grid) return;
  let box = document.getElementById('llamacpp-external');
  if (!box) { box = document.createElement('div'); box.id = 'llamacpp-external'; grid.after(box); }
  // How they are found: the model servers' own discovery (the sidebar's), or each one's /props — kept beside it (W14).
  const pick = `<select class="input" style="width:auto;margin-left:8px;font-size:11px;padding:1px 4px" title="How these are found" onchange="llamaSetDiscovery(this.value)">
    <option value="servers"${via === 'servers' ? ' selected' : ''}>found as model servers</option>
    <option value="props"${via === 'props' ? ' selected' : ''}>found by /props</option></select>`;
  box.innerHTML = list.length ? `<div class="input-label" style="margin:12px 0 6px">Running outside the panel${pick}</div>` + list.map(s => `
    <div class="disk-row" title="${escHtml(s.build ? `llama.cpp ${s.build}` : 'llama.cpp')} — started outside DOCA, so it is shown here and managed where it was started">
      <span class="disk-label">${escHtml(s.label)}${s.router ? ' · router' : ''}${s.foreign ? ' · working for something else' : s.doca ? ' · working for DOCA' : ''}</span>
      <span class="disk-path">${escHtml(s.url)}</span>
      <span class="disk-free">${s.models.length ? s.models.map(m => `${escHtml(m.id)} (${escHtml(m.state || '?')}${m.ctx ? `, ${m.ctx.toLocaleString()} ctx` : ''})`).join(' · ')
        : s.ctx ? `${s.ctx.toLocaleString()} ctx` : ''}</span>
    </div>`).join('') : '';
}

/** Which way the tab finds them (llamacpp.discovery): the rest of the llamacpp prefs are kept as they are. */
async function llamaSetDiscovery(via) {
  try {
    const cur = (await apiFetch('/api/prefs')).llamacpp || {};
    await apiFetch('/api/prefs', { method: 'POST', body: { llamacpp: { ...cur, discovery: via } } });
  } catch (e) { appAlert(`Could not save: ${e.message}`); }
  llamaLoadList();
}

async function llamaLoadStatus() {
  try {
    const data = await apiFetch('/api/models/llamacpp/status');
    _llamaStatus = data.status || {};
  } catch { _llamaStatus = {}; }
  await machineOriginsLoad();   // who started each (lib/machine-origin.js)
  _updateLlamaBadges();
}

/* ── Rendering ──────────────────────────────────────── */

function _renderLlamaGrid() {
  const grid = document.getElementById('llamacpp-grid');
  if (!grid) return;

  if (!_llamaInstances.length) {
    grid.innerHTML = '<div class="placeholder" style="padding:12px">No llama.cpp instances configured</div>';
    return;
  }

  grid.innerHTML = _llamaInstances.map(inst => {
    const running = inst.running;
    return `
    <div class="llamacpp-row" id="llama-row-${inst.id}">
      <div class="services-header">
        <span class="badge ${running ? 'badge-green' : 'badge-grey'}" id="llama-badge-${inst.id}">
          ${running ? '● running' : '○ stopped'}
        </span>
        <span class="services-label">${inst.name}<span class="m-origin" id="llama-origin-${inst.id}"></span></span>
        <span style="flex:1"></span>
        <a id="llama-url-${inst.id}" class="services-url"
           style="display:${running ? '' : 'none'}"
           href="http://localhost:${inst.port}/v1/models" target="_blank">
          ${inst.endpoint}
        </a>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:2px 0 4px;word-break:break-all"
           title="${inst.modelPath}">
        ${inst.modelPath ? inst.modelPath.split(/[\\/]/).pop() : '<em>no model set</em>'}${inst.source ? ` · from ${escHtml(inst.source.repo)}` : ''}${inst.mmprojPath ? ' · reads pictures' : ''}${inst.jinja ? ' · its own chat template (tool calls)' : ''}
      </div>
      <div class="llamacpp-controls">
        <label class="services-ctrl-label">Model</label>
        <div style="display:flex;gap:4px;align-items:center;flex:1;min-width:200px">
          <input class="input" id="llama-model-${inst.id}" value="${inst.modelPath || ''}"
                 style="flex:1;min-width:0;font-size:10px" placeholder="/path/to/model.gguf">
          <button class="btn btn-xs" title="Browse" onclick="fpOpen('llama-model-${inst.id}','file')">📁</button>
        </div>
        <label class="services-ctrl-label">Port</label>
        <input class="input" id="llama-port-${inst.id}" value="${inst.port}" type="number"
               style="width:70px" min="1024" max="65535">
      </div>
      ${advancedFold(`<div class="llamacpp-controls">
        <label class="services-ctrl-label">GPU Layers</label>
        <input class="input" id="llama-ngl-${inst.id}" value="${inst.nGpuLayers ?? 999}" title="A number, or auto: llama.cpp places them"
               data-default="999" data-label="GPU layers" style="width:60px" inputmode="numeric">
        <label class="services-ctrl-label">Ctx Size</label>
        <input class="input" id="llama-ctx-${inst.id}" value="${inst.ctxSize || 8192}" type="number" data-default="8192" data-label="Context size"
               style="width:70px" min="128" step="128">
      </div>`, { id: 'llamacpp-instance', label: 'Advanced — GPU layers, context size' })}
      <div class="llamacpp-actions">
        <button class="btn btn-sm btn-blue" onclick="llamaSaveConfig('${inst.id}')">💾 Save</button>
        <button class="btn btn-sm btn-teal" id="llama-start-${inst.id}"
                onclick="llamaStart('${inst.id}')"
                ${running ? 'style="display:none"' : ''}>▶ Start</button>
        <button class="btn btn-sm btn-red" id="llama-stop-${inst.id}"
                onclick="llamaStop('${inst.id}')"
                ${running ? '' : 'style="display:none"'}>■ Stop</button>
        <button class="btn btn-sm btn-amber" id="llama-restart-${inst.id}"
                onclick="llamaRestart('${inst.id}')"
                ${running ? '' : 'style="display:none"'}>↺ Restart</button>
        <button class="btn btn-sm" onclick="llamaHealth('${inst.id}')">♥ Health</button>
        <button class="btn btn-xs btn-red" onclick="llamaDelete('${inst.id}')" title="Remove instance"
                style="margin-left:auto">✕</button>
        <span class="status-line" id="llama-status-${inst.id}"></span>
      </div>
      <pre class="install-out" id="llama-out-${inst.id}" style="display:none;max-height:180px;margin-top:6px"></pre>
    </div>`;
  }).join('');
}

function _updateLlamaBadges() {
  for (const inst of _llamaInstances) {
    const info    = _llamaStatus[inst.id];
    const running = info?.running === true;
    machineOriginFill(document.getElementById(`llama-origin-${inst.id}`), 'llamacpp', inst.id);
    const badge   = document.getElementById(`llama-badge-${inst.id}`);
    const urlEl   = document.getElementById(`llama-url-${inst.id}`);
    const startBtn   = document.getElementById(`llama-start-${inst.id}`);
    const stopBtn    = document.getElementById(`llama-stop-${inst.id}`);
    const restartBtn = document.getElementById(`llama-restart-${inst.id}`);

    if (!badge) continue;

    if (running) {
      badge.textContent = '● running';
      badge.className   = 'badge badge-green';
      if (urlEl)      urlEl.style.display      = '';
      if (startBtn)   startBtn.style.display   = 'none';
      if (stopBtn)    stopBtn.style.display     = '';
      if (restartBtn) restartBtn.style.display  = '';
    } else {
      badge.textContent = '○ stopped';
      badge.className   = 'badge badge-grey';
      if (urlEl)      urlEl.style.display      = 'none';
      if (startBtn)   startBtn.style.display   = '';
      if (stopBtn)    stopBtn.style.display     = 'none';
      if (restartBtn) restartBtn.style.display  = 'none';
    }
  }
}

/* ── Config ──────────────────────────────────────────── */

async function llamaSaveConfig(id) {
  const status = document.getElementById(`llama-status-${id}`);
  const body = {
    id,
    name:       _llamaInstances.find(i => i.id === id)?.name || id,
    modelPath:  document.getElementById(`llama-model-${id}`)?.value.trim() || '',
    port:       document.getElementById(`llama-port-${id}`)?.value         || '11435',
    nGpuLayers: document.getElementById(`llama-ngl-${id}`)?.value          || '999',
    ctxSize:    document.getElementById(`llama-ctx-${id}`)?.value          || '8192',
  };
  try {
    await apiFetch('/api/models/llamacpp/config', { method: 'POST', body });
    setStatus(status, '✓ Saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function llamaAddInstance() {
  appPrompt('Instance ID (lowercase, no spaces):', async (id) => {
    id = id.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    if (!id) return;
    try {
      await apiFetch('/api/models/llamacpp/config', {
        method: 'POST',
        body: { id, name: id, modelPath: '', port: 11436, nGpuLayers: 999, ctxSize: 8192 },
      });
      llamaLoadList();
    } catch (e) { appAlert(`Error: ${e.message}`); }
  });
}

function llamaDelete(id) {
  machineAsk('llamacpp', id, 'delete', `the llama.cpp instance "${id}"`, async () => {
    try {
      await apiFetch(`/api/models/llamacpp/${id}`, { method: 'DELETE' });
      llamaLoadList();
    } catch (e) { appAlert(`Delete error: ${e.message}`); }
  });
}

/* ── Actions ─────────────────────────────────────────── */

async function llamaStart(id) {
  const out      = document.getElementById(`llama-out-${id}`);
  const startBtn = document.getElementById(`llama-start-${id}`);

  if (out)      { out.style.display = 'block'; out.textContent = 'Starting llama-server…\n'; }
  if (startBtn) startBtn.disabled = true;

  await sseStream('/api/models/llamacpp/start', { id }, {
    onStatus: text => appendStream(out, text),
    onDone: () => {
      llamaLoadStatus();
      if (startBtn) startBtn.disabled = false;
    },
    onError: e => {
      if (out) out.textContent += `\nError: ${e.message}`;
    },
  });
  llamaLoadStatus();
  if (startBtn) startBtn.disabled = false;
}

async function llamaStop(id, asked) {
  if (!asked) return machineAsk('llamacpp', id, 'stop', '', () => llamaStop(id, true));   // names what uses it (lib/machine-ask.js)
  const stopBtn = document.getElementById(`llama-stop-${id}`);
  if (stopBtn) stopBtn.disabled = true;
  try {
    await apiFetch('/api/models/llamacpp/stop', { method: 'POST', body: { id } });
  } catch (e) {
    const out = document.getElementById(`llama-out-${id}`);
    if (out) { out.style.display = 'block'; out.textContent += `\nStop error: ${e.message}`; }
  }
  if (stopBtn) stopBtn.disabled = false;
  setTimeout(llamaLoadStatus, 500);
}

async function llamaRestart(id, asked) {
  if (!asked) return machineAsk('llamacpp', id, 'restart', '', () => llamaRestart(id, true), 'It stops while the model loads again.');
  const out = document.getElementById(`llama-out-${id}`);
  const restartBtn = document.getElementById(`llama-restart-${id}`);

  if (out) { out.style.display = 'block'; out.textContent = 'Restarting llama-server…\n'; }
  if (restartBtn) restartBtn.disabled = true;

  await sseStream('/api/models/llamacpp/restart', { id }, {
    onStatus: text => appendStream(out, text),
    onDone: () => {
      llamaLoadStatus();
      if (restartBtn) restartBtn.disabled = false;
    },
    onError: e => {
      if (out) out.textContent += `\nError: ${e.message}`;
    },
  });
  llamaLoadStatus();
  if (restartBtn) restartBtn.disabled = false;
}

async function llamaHealth(id) {
  const status = document.getElementById(`llama-status-${id}`);
  setStatus(status, '…checking', 'info');
  try {
    const data = await apiFetch('/api/models/llamacpp/health', { method: 'POST', body: { id } });
    if (data.healthy) {
      setStatus(status, '✓ Healthy', 'ok');
    } else {
      setStatus(status, `✗ ${data.error || 'Unhealthy'}`, 'err');
    }
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
  // No clear of its own: a check that came back healthy fades on the shared
  // schedule, and one that did not stays until the next check replaces it. The
  // five-second wipe this used to end with took the unhealthy answer with it.
}

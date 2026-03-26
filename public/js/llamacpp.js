/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — LLAMA.CPP SERVER MANAGEMENT
   Manages native llama-server processes with configurable
   model, port, GPU layers, and context size.
   ═══════════════════════════════════════════════════════ */

let _llamaInstances = [];
let _llamaStatus    = {};

async function llamaInit() {
  await llamaLoadList();
}

async function llamaLoadList() {
  try {
    const data = await apiFetch('/api/models/llamacpp/list');
    _llamaInstances = data.instances || [];
  } catch { _llamaInstances = []; }
  _renderLlamaGrid();
}

async function llamaLoadStatus() {
  try {
    const data = await apiFetch('/api/models/llamacpp/status');
    _llamaStatus = data.status || {};
  } catch { _llamaStatus = {}; }
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
        <span class="services-label">${inst.name}</span>
        <span style="flex:1"></span>
        <a id="llama-url-${inst.id}" class="services-url"
           style="display:${running ? '' : 'none'}"
           href="http://localhost:${inst.port}/v1/models" target="_blank">
          ${inst.endpoint}
        </a>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:2px 0 4px;word-break:break-all"
           title="${inst.modelPath}">
        ${inst.modelPath ? inst.modelPath.split('/').pop() : '<em>no model set</em>'}
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
        <label class="services-ctrl-label">GPU Layers</label>
        <input class="input" id="llama-ngl-${inst.id}" value="${inst.nGpuLayers ?? 999}" type="number"
               style="width:60px" min="0">
        <label class="services-ctrl-label">Ctx Size</label>
        <input class="input" id="llama-ctx-${inst.id}" value="${inst.ctxSize || 8192}" type="number"
               style="width:70px" min="128" step="128">
      </div>
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
    setTimeout(() => setStatus(status, ''), 3000);
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
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

function llamaDelete(id) {
  appConfirm(`Delete llama.cpp instance "${id}"?`, async () => {
    try {
      await apiFetch(`/api/models/llamacpp/${id}`, { method: 'DELETE' });
      llamaLoadList();
    } catch (e) { alert(`Delete error: ${e.message}`); }
  });
}

/* ── Actions ─────────────────────────────────────────── */

async function llamaStart(id) {
  const out      = document.getElementById(`llama-out-${id}`);
  const startBtn = document.getElementById(`llama-start-${id}`);

  if (out)      { out.style.display = 'block'; out.textContent = 'Starting llama-server…\n'; }
  if (startBtn) startBtn.disabled = true;

  try {
    const res = await fetch('/api/models/llamacpp/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const read = async () => {
      const { done, value } = await reader.read();
      if (done) { llamaLoadStatus(); if (startBtn) startBtn.disabled = false; return; }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      parts.forEach(part => {
        const line = part.trim().replace(/^data:\s*/, '');
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          if (obj.status && out) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
          if (obj.done) {
            llamaLoadStatus();
            if (startBtn) startBtn.disabled = false;
          }
        } catch {}
      });
      read();
    };
    read();
  } catch (e) {
    if (out) out.textContent += `\nError: ${e.message}`;
    if (startBtn) startBtn.disabled = false;
    llamaLoadStatus();
  }
}

async function llamaStop(id) {
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

async function llamaRestart(id) {
  const out = document.getElementById(`llama-out-${id}`);
  const restartBtn = document.getElementById(`llama-restart-${id}`);

  if (out) { out.style.display = 'block'; out.textContent = 'Restarting llama-server…\n'; }
  if (restartBtn) restartBtn.disabled = true;

  try {
    const res = await fetch('/api/models/llamacpp/restart', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const read = async () => {
      const { done, value } = await reader.read();
      if (done) { llamaLoadStatus(); if (restartBtn) restartBtn.disabled = false; return; }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      parts.forEach(part => {
        const line = part.trim().replace(/^data:\s*/, '');
        if (!line) return;
        try {
          const obj = JSON.parse(line);
          if (obj.status && out) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
          if (obj.done) {
            llamaLoadStatus();
            if (restartBtn) restartBtn.disabled = false;
          }
        } catch {}
      });
      read();
    };
    read();
  } catch (e) {
    if (out) out.textContent += `\nError: ${e.message}`;
    if (restartBtn) restartBtn.disabled = false;
    llamaLoadStatus();
  }
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
  setTimeout(() => setStatus(status, ''), 5000);
}

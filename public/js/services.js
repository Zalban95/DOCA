/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — INFERENCE SERVICES
   Manages Docker-based inference backends (Whisper, vLLM,
   Stable Diffusion, ComfyUI) with GPU assignment.
   ═══════════════════════════════════════════════════════ */

let _servicesDefs   = [];  // loaded from GET /api/services
let _servicesStatus = {};  // running map from GET /api/services/status
let _servicesImages = {};  // image presence map from GET /api/services/status

async function servicesInit() {
  try {
    const data = await apiFetch('/api/services');
    _servicesDefs = data.services || [];
  } catch { _servicesDefs = []; }
  _renderServicesGrid();
  servicesLoadStatus();
}

async function servicesLoadStatus() {
  try {
    const data = await apiFetch('/api/services/status');
    _servicesStatus = data.running || {};
    _servicesImages = data.images  || {};
  } catch { _servicesStatus = {}; _servicesImages = {}; }
  _updateServicesBadges();
}

/* ── Rendering ──────────────────────────────────────── */

function _renderServicesGrid() {
  const grid = document.getElementById('services-grid');
  if (!grid) return;

  grid.innerHTML = _servicesDefs.map(svc => {
    const isVllm = svc.id === 'vllm';
    const g      = svc.savedGpu || 'all';
    const gpuOpts = ['0','1','all',''].map(v =>
      `<option value="${v}"${g===v?' selected':''}>${v==='all'?'Both GPUs':v===''?'No GPU (CPU)':`GPU ${v}`}</option>`
    ).join('');
    return `
    <div class="services-row" id="svc-row-${svc.id}">
      <div class="services-header">
        <span class="badge badge-grey" id="svc-badge-${svc.id}">○ stopped</span>
        <span class="services-label">${svc.label}</span>
        <span class="services-image">${svc.image}</span>
        <span class="badge" id="svc-img-badge-${svc.id}" style="display:none;font-size:9px"></span>
        <span style="flex:1"></span>
        <a id="svc-url-${svc.id}" class="services-url" style="display:none"
           href="http://localhost:${svc.port}" target="_blank">
          http://localhost:${svc.port}
        </a>
        <button class="btn btn-xs tool-gear" title="Service settings"
                onclick="svcToggleConfig('${svc.id}')">⚙</button>
      </div>
      <div style="font-size:10px;color:var(--muted);margin:2px 0 6px">${svc.description}</div>
      <div class="services-controls" id="svc-config-${svc.id}" style="display:none">
        <label class="services-ctrl-label">GPU</label>
        <select class="input services-select" id="svc-gpu-${svc.id}" style="width:130px"
                onchange="_svcSaveSettings('${svc.id}')">${gpuOpts}</select>
        ${isVllm ? `
        <label class="services-ctrl-label">Model ID</label>
        <input class="input services-model-input" id="svc-model-${svc.id}"
               placeholder="e.g. Qwen/Qwen2.5-7B-Instruct"
               value="${svc.savedModelId || ''}"
               style="flex:1;min-width:180px"
               onchange="_svcSaveSettings('${svc.id}')">
        ` : ''}
        ${svc.cpuImage ? `<span style="font-size:10px;color:var(--muted)">CPU image: <code>${svc.cpuImage}</code></span>` : ''}
      </div>
      <div class="services-controls">
        <button class="btn btn-sm btn-teal"   id="svc-start-${svc.id}" onclick="serviceStart('${svc.id}')">▶ Start</button>
        <button class="btn btn-sm btn-red"    id="svc-stop-${svc.id}"  onclick="serviceStop('${svc.id}')"  style="display:none">■ Stop</button>
        <button class="btn btn-sm btn-purple" id="svc-pull-${svc.id}"  onclick="servicePullImage('${svc.id}')" style="display:none">⬇ Pull image</button>
      </div>
      <pre class="install-out" id="svc-out-${svc.id}" style="display:none;max-height:160px;margin-top:6px"></pre>
      <div id="svc-api-note-${svc.id}" style="display:none;font-size:10px;color:var(--green);margin-top:4px">
        ✓ Registered in Tool APIs → <strong>${svc.id}</strong>
      </div>
    </div>`;
  }).join('');

  _updateServicesBadges();
}

function svcToggleConfig(id) {
  const row = document.getElementById(`svc-config-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
}

function _updateServicesBadges() {
  _servicesDefs.forEach(svc => {
    const info     = _servicesStatus[svc.id];
    const running  = info?.state === 'running';
    const badge    = document.getElementById(`svc-badge-${svc.id}`);
    const urlEl    = document.getElementById(`svc-url-${svc.id}`);
    const startBtn = document.getElementById(`svc-start-${svc.id}`);
    const stopBtn  = document.getElementById(`svc-stop-${svc.id}`);
    const imgBadge = document.getElementById(`svc-img-badge-${svc.id}`);
    const pullBtn  = document.getElementById(`svc-pull-${svc.id}`);

    if (!badge) return;

    if (running) {
      badge.textContent = '● running';
      badge.className   = 'badge badge-green';
      if (urlEl)    urlEl.style.display    = '';
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn)  stopBtn.style.display  = '';
    } else {
      badge.textContent = '○ stopped';
      badge.className   = 'badge badge-grey';
      if (urlEl)    urlEl.style.display    = 'none';
      if (startBtn) startBtn.style.display = '';
      if (stopBtn)  stopBtn.style.display  = 'none';
    }

    // Image presence (auto-checked): show a pull button when the image is missing
    const img = _servicesImages[svc.id];
    if (imgBadge && img) {
      imgBadge.style.display = '';
      if (img.present) {
        imgBadge.textContent = '✓ image';
        imgBadge.className   = 'badge badge-green';
        imgBadge.style.fontSize = '9px';
        if (pullBtn) pullBtn.style.display = 'none';
      } else {
        imgBadge.textContent = '⬇ image not pulled';
        imgBadge.className   = 'badge badge-red';
        imgBadge.style.fontSize = '9px';
        if (pullBtn && !running) pullBtn.style.display = '';
      }
    }
  });
}

/** Pull the Docker image for a service (streams progress into the row output). */
async function servicePullImage(id) {
  const svc = _servicesDefs.find(s => s.id === id);
  if (!svc) return;
  const gpu   = document.getElementById(`svc-gpu-${id}`)?.value ?? (svc.savedGpu || 'all');
  const image = gpu === '' && svc.cpuImage ? svc.cpuImage : svc.image;
  const out     = document.getElementById(`svc-out-${id}`);
  const pullBtn = document.getElementById(`svc-pull-${id}`);

  if (out)     { out.style.display = 'block'; out.textContent = `Pulling ${image}…\n`; }
  if (pullBtn) pullBtn.disabled = true;

  await sseStream('/api/docker/images/pull', { name: image }, {
    onStatus: text => appendStream(out, text),
    onError:  e => { if (out) out.textContent += `\nError: ${e.message}`; },
  });
  if (pullBtn) pullBtn.disabled = false;
  appendStream(out, '\n✓ Pull finished\n');
  servicesLoadStatus();
}

async function _svcSaveSettings(id) {
  const gpu     = document.getElementById(`svc-gpu-${id}`)?.value   ?? 'all';
  const modelId = document.getElementById(`svc-model-${id}`)?.value ?? '';
  try { await apiFetch('/api/services/settings', { method: 'POST', body: { id, gpu, modelId } }); } catch {}
}

/* ── Actions ────────────────────────────────────────── */

async function serviceStart(id) {
  const svc     = _servicesDefs.find(s => s.id === id);
  if (!svc) return;
  const gpu     = document.getElementById(`svc-gpu-${id}`)?.value   || '0';
  const modelId = document.getElementById(`svc-model-${id}`)?.value || '';
  const out     = document.getElementById(`svc-out-${id}`);
  const startBtn = document.getElementById(`svc-start-${id}`);
  const apiNote  = document.getElementById(`svc-api-note-${id}`);

  if (out)     { out.style.display = 'block'; out.textContent = `Starting ${svc.label}…\n`; }
  if (startBtn)  startBtn.disabled = true;
  if (apiNote)   apiNote.style.display = 'none';

  await sseStream('/api/services/start', { id, gpu, modelId }, {
    onStatus: text => appendStream(out, text),
    onDone: obj => {
      if (obj.ok && apiNote) apiNote.style.display = '';
    },
    onError: e => {
      if (out) out.textContent += `\nError: ${e.message}`;
    },
  });
  servicesLoadStatus();
  if (startBtn) startBtn.disabled = false;
}

async function serviceStop(id) {
  const stopBtn = document.getElementById(`svc-stop-${id}`);
  if (stopBtn) stopBtn.disabled = true;
  try {
    await apiFetch('/api/services/stop', { method: 'POST', body: { id } });
  } catch (e) {
    const out = document.getElementById(`svc-out-${id}`);
    if (out) { out.style.display = 'block'; out.textContent += `\nStop error: ${e.message}`; }
  }
  if (stopBtn) stopBtn.disabled = false;
  servicesLoadStatus();
}

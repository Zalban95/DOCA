/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SIDEBAR STATUS POLLING
   ═══════════════════════════════════════════════════════ */

async function pollStatus() {
  try {
    const data = await apiFetch('/api/status');
    document.getElementById('dot').className = 'dot on';

    renderContainers(data.containers || []);
    renderGPU(data.gpu || []);
    renderSystem(data.system || null);
    renderModels(data.models || [], data.loadedModels || []);
    renderHfModels(data.hfModels || []);
    pollLlamaCppStatus();
    pollServicesStatus();

  } catch {
    document.getElementById('dot').className = 'dot';
  }
}

async function pollLlamaCppStatus() {
  const el = document.getElementById('s-llamacpp');
  if (!el) return;
  try {
    const data = await apiFetch('/api/models/llamacpp/list');
    const instances = data.instances || [];
    const running = instances.filter(i => i.running);
    if (!running.length) {
      el.innerHTML = '<div class="placeholder">None running</div>';
      return;
    }
    el.innerHTML = running.map(i =>
      `<div class="model-item">
        <span class="dot on" style="width:7px;height:7px;flex-shrink:0"></span>
        <span class="model-name" title="${i.endpoint}">${i.name}</span>
        <span class="model-sz">:${i.port}</span>
       </div>`
    ).join('');
    if (typeof llamaLoadStatus === 'function') llamaLoadStatus();
  } catch {
    el.innerHTML = '<div class="placeholder">—</div>';
  }
}

async function pollServicesStatus() {
  const el = document.getElementById('s-services');
  if (!el) return;
  try {
    const data = await apiFetch('/api/services/status');
    const running = data.running || {};
    const keys = Object.keys(running).filter(k => running[k]?.state === 'running');
    if (!keys.length) {
      el.innerHTML = '<div class="placeholder">None running</div>';
      return;
    }
    el.innerHTML = keys.map(id =>
      `<div class="model-item">
        <span class="dot on" style="width:7px;height:7px;flex-shrink:0"></span>
        <span class="model-name">${id}</span>
       </div>`
    ).join('');
    // Also keep services.js in sync if the tab is open
    if (typeof servicesLoadStatus === 'function') servicesLoadStatus();
  } catch {
    el.innerHTML = '<div class="placeholder">—</div>';
  }
}

function renderContainers(containers) {
  const el = document.getElementById('s-containers');
  if (!containers.length) {
    el.innerHTML = '<div class="placeholder">None running</div>'; return;
  }
  // Show running containers first, then others; limit to 12 for sidebar compactness
  const sorted = [...containers].sort((a, b) => {
    const aUp = (a.State || a.Status || '').toLowerCase().includes('running') ? 0 : 1;
    const bUp = (b.State || b.Status || '').toLowerCase().includes('running') ? 0 : 1;
    return aUp - bUp;
  });
  const shown = sorted.slice(0, 12);
  const runningCount = sorted.filter(c => (c.State || c.Status || '').toLowerCase().includes('running')).length;
  const countEl = document.getElementById('s-containers-count');
  if (countEl) countEl.textContent = `${runningCount}/${sorted.length} running`;

  el.innerHTML = shown.map(c => {
    const st    = (c.State || c.Status || '').toLowerCase();
    const up    = st.includes('running') || st.includes('up');
    const rawName = c.Names || c.Name || c.Service || '';
    const label   = rawName.replace(/^\//, '').split(',')[0]
      .replace('openclaw-openclaw-', '').replace(/-1$/, '');
    return `<div class="c-item ${up ? 'running' : 'exited'}">
      <span class="c-name" title="${label}">${label}</span>
      <span class="c-state">${st.split(' ')[0].split('(')[0]}</span>
    </div>`;
  }).join('') + (sorted.length > 12 ? `<div class="placeholder" style="font-size:10px">+${sorted.length - 12} more</div>` : '');
}

function renderGPU(gpus) {
  const el = document.getElementById('s-gpu');
  if (!gpus.length) {
    el.innerHTML = '<div class="placeholder">No GPU data</div>'; return;
  }
  el.innerHTML = gpus.map((g, i) => {
    const usedMB  = parseInt(g.memUsed)  || 0;
    const totalMB = parseInt(g.memTotal) || 1;
    const pct = Math.round((usedMB / totalMB) * 100);
    const barColor = pct > 90 ? 'red' : pct > 70 ? 'amber' : 'green';
    return `<div class="gpu-card">
      <div class="gpu-name">GPU ${i} — ${g.name}</div>
      <div class="gpu-grid">
        <div class="gm"><span class="gm-l">Temp</span><span class="gm-v">${g.temp}°C</span></div>
        <div class="gm"><span class="gm-l">Util</span><span class="gm-v">${g.util}%</span></div>
        <div class="gm"><span class="gm-l">VRAM</span><span class="gm-v">${g.memUsed}/${g.memTotal} MB</span></div>
        <div class="gm"><span class="gm-l">Used</span><span class="gm-v">${pct}%</span></div>
        <div class="res-bar"><div class="res-bar-fill ${barColor}" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

function renderSystem(sys) {
  const el = document.getElementById('s-system');
  if (!sys) {
    el.innerHTML = '<div class="placeholder">No system data</div>'; return;
  }
  const cpuPct  = Math.round(sys.cpuPct || 0);
  const ramPct  = Math.round((sys.ramUsed / sys.ramTotal) * 100) || 0;
  const cpuColor = cpuPct > 90 ? 'red' : cpuPct > 70 ? 'amber' : 'green';
  const ramColor = ramPct > 90 ? 'red' : ramPct > 70 ? 'amber' : 'blue';

  el.innerHTML = `<div class="sys-card">
    <div class="sys-grid">
      <div class="sys-metric">
        <span class="sys-label">CPU</span>
        <span class="sys-value cpu">${cpuPct}%</span>
      </div>
      <div class="sys-metric">
        <span class="sys-label">Load</span>
        <span class="sys-value cpu">${(sys.load1 || 0).toFixed(2)}</span>
      </div>
      <div class="res-bar"><div class="res-bar-fill ${cpuColor}" style="width:${cpuPct}%"></div></div>

      <div class="sys-metric">
        <span class="sys-label">RAM</span>
        <span class="sys-value ram">${fmtBytes(sys.ramUsed * 1e6)}</span>
      </div>
      <div class="sys-metric">
        <span class="sys-label">Total</span>
        <span class="sys-value ram">${fmtBytes(sys.ramTotal * 1e6)}</span>
      </div>
      <div class="res-bar"><div class="res-bar-fill ${ramColor}" style="width:${ramPct}%"></div></div>
    </div>
  </div>`;
}

function renderModels(models, loadedModels) {
  const el = document.getElementById('s-models');
  if (!models.length && !loadedModels.length) {
    el.innerHTML = '<div class="placeholder">No models installed</div>'; return;
  }

  const loadedNames = new Set(loadedModels.map(m => m.name));

  // Loaded models section (if any)
  let html = '';
  if (loadedModels.length) {
    const totalVram = loadedModels.reduce((s, m) => s + (m.sizeVram || 0), 0);
    html += `<div class="models-loaded-header">● In memory (${loadedModels.length})</div>`;
    html += loadedModels.map(m => {
      const name    = m.name.replace(/:latest$/, '');
      const vram    = m.sizeVram || 0;
      const pct     = totalVram > 0 ? Math.round(vram / totalVram * 100) : 0;
      const vramStr = vram > 0 ? fmtBytes(vram) : '';
      return `<div class="model-item loaded">
        <span class="model-name loaded-name" title="${m.name}">${name}</span>
        ${vram > 0 ? `<span class="model-vram">${vramStr} (${pct}%)</span>` : ''}
      </div>`;
    }).join('');
  }

  // Installed models (excluding already-loaded ones)
  const others = models.filter(m => !loadedNames.has(m.name));
  if (others.length) {
    if (loadedModels.length) html += `<div class="models-loaded-header" style="margin-top:6px;opacity:.5">Installed</div>`;
    html += others.map(m => {
      const name = m.name.replace(/:latest$/, '');
      const size = m.size ? fmtBytes(m.size) : '?';
      return `<div class="model-item">
        <span class="model-name">${name}</span>
        <span class="model-sz">${size}</span>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
}


function renderHfModels(repos) {
  const el = document.getElementById('s-hf-models');
  if (!el) return;
  if (!repos || !repos.length) {
    el.innerHTML = '<div class="placeholder">No cached models</div>'; return;
  }
  el.innerHTML = repos.map(r => {
    const name = r.repo_id;
    return `<div class="model-item">
      <span class="model-name" title="${name}">${name}</span>
    </div>`;
  }).join('');
}

// Clock
function startClock() {
  const el = document.getElementById('clock');
  function tick() { el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); }
  tick();
  setInterval(tick, 1000);
}

// Init
setInterval(pollStatus, 5000);
pollStatus();
startClock();

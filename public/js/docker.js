/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — DOCKER TAB
   ═══════════════════════════════════════════════════════ */

let _dockerLogSrc = null;
let _dockerLogContainerId = null;
let _dockerPresets = {};
let _dockerContainers = [];

function dockerInit() {
  dockerLoadPresets();
  dockerLoadContainers();
  dockerLoadImages();
}

/* ── Presets (saved configurations) ──────────────────── */
async function dockerLoadPresets() {
  try {
    const data = await apiFetch('/api/docker/presets');
    _dockerPresets = data.presets || {};
  } catch { _dockerPresets = {}; }
  _dockerRenderPresets();
}

function _dockerRenderPresets() {
  const section = document.getElementById('docker-presets-section');
  const grid    = document.getElementById('docker-presets-grid');
  const entries = Object.values(_dockerPresets);
  if (!entries.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  grid.innerHTML = entries.map(p => {
    const running = _dockerContainers.some(c =>
      (c.State || '').toLowerCase() === 'running' && c.Image === p.image
    );
    const statusBadge = running
      ? '<span class="badge badge-green" style="font-size:8px">RUNNING</span>'
      : '<span class="badge" style="font-size:8px;background:var(--dim)">STOPPED</span>';
    const gpuTag = p.gpu ? `<span class="badge" style="font-size:8px;background:var(--purple)">GPU ${p.gpu}</span>` : '';
    const portsTag = (p.ports || []).length
      ? `<span style="color:var(--muted)">${p.ports.join(', ')}</span>` : '';
    const eName = encodeURIComponent(p.name);

    return `<div class="docker-preset-card">
      <div class="docker-preset-card-header">
        <span class="docker-preset-card-name">${_dockerEsc(p.name)}</span>
        ${statusBadge}
      </div>
      <div class="docker-preset-card-image">${_dockerEsc(p.image)}</div>
      <div class="docker-preset-card-meta">${gpuTag} ${portsTag}</div>
      <div class="docker-preset-card-actions">
        <button class="btn btn-xs btn-green" onclick="dockerPresetRun('${eName}')">▶ Run</button>
        <button class="btn btn-xs btn-blue" onclick="dockerPresetCreate('${eName}')">+ Create</button>
        <button class="btn btn-xs" onclick="dockerPresetEdit('${eName}')">✏ Edit</button>
        <button class="btn btn-xs btn-red" onclick="dockerPresetDelete('${eName}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function dockerPresetRun(encodedName) {
  const p = _dockerPresets[decodeURIComponent(encodedName)];
  if (!p) return;
  _dockerRunFromPreset(p, false);
}

function dockerPresetCreate(encodedName) {
  const p = _dockerPresets[decodeURIComponent(encodedName)];
  if (!p) return;
  _dockerRunFromPreset(p, true);
}

function _dockerRunFromPreset(p, createOnly) {
  const out = document.getElementById('docker-run-out');
  out.style.display = 'block';
  out.textContent = `${createOnly ? 'Creating' : 'Starting'} ${p.image}…\n`;

  fetch('/api/docker/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: p.image, name: p.name, ports: p.ports || [], gpu: p.gpu || '',
      restart: p.restart || 'no', envVars: p.envVars || [], volumes: p.volumes || [],
      createOnly
    })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const read = () => {
      reader.read().then(({ done, value }) => {
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(part => {
          const line = part.trim().replace(/^data:\s*/, '');
          if (!line) return;
          try {
            const obj = JSON.parse(line);
            if (obj.status) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
            if (obj.done && obj.ok) {
              setTimeout(() => { dockerLoadContainers(); dockerLoadPresets(); }, 800);
            }
          } catch {}
        });
        read();
      });
    };
    read();
  }).catch(e => { out.textContent += `\nError: ${e.message}`; });

  document.getElementById('docker-run-modal').classList.add('open');
  document.getElementById('docker-run-image-label').textContent = p.image;
  document.getElementById('docker-run-ok').disabled = true;
}

function dockerPresetEdit(encodedName) {
  const p = _dockerPresets[decodeURIComponent(encodedName)];
  if (!p) return;
  _dockerRunImageRef = p.image;
  document.getElementById('docker-run-image-label').textContent = p.image;
  document.getElementById('docker-run-name').value = p.name || '';
  document.getElementById('docker-run-ports').value = (p.ports || []).join(', ');
  document.getElementById('docker-run-gpu').value = p.gpu || '';
  document.getElementById('docker-run-restart').value = p.restart || 'unless-stopped';
  document.getElementById('docker-run-env').value = (p.envVars || []).join('\n');
  document.getElementById('docker-run-volumes').value = (p.volumes || []).join('\n');
  document.getElementById('docker-run-out').style.display = 'none';
  document.getElementById('docker-run-out').textContent = '';
  document.getElementById('docker-run-ok').disabled = false;
  document.getElementById('docker-run-modal').classList.add('open');
}

async function dockerPresetDelete(encodedName) {
  const name = decodeURIComponent(encodedName);
  appConfirm(`Delete saved configuration "${name}"?`, async () => {
    try {
      await apiFetch(`/api/docker/presets/${encodedName}`, { method: 'DELETE' });
      dockerLoadPresets();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

/* ── Containers ────────────────────────────────────────── */
async function dockerLoadContainers() {
  const tbody = document.getElementById('docker-containers-body');
  tbody.innerHTML = '<tr><td colspan="5" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/docker/containers');
    _dockerContainers = data.containers || [];
    if (!_dockerContainers.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder" style="padding:12px">No containers found</td></tr>';
      _dockerRenderPresets();
      return;
    }
    tbody.innerHTML = _dockerContainers.map(c => {
      const isRunning = (c.State || '').toLowerCase() === 'running';
      const statusClass = isRunning ? 'badge-green' : 'badge-red';
      const ports = c.Ports || '';

      return `<tr class="models-row" id="docker-container-${c.ID}">
        <td class="models-name" style="font-size:11px">${c.Names || c.ID.slice(0,12)}</td>
        <td style="font-size:10px;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis">${c.Image || '—'}</td>
        <td><span class="badge ${statusClass}" style="font-size:9px">${c.Status || c.State || '—'}</span></td>
        <td style="font-size:10px;color:var(--muted)">${ports.slice(0,40) || '—'}</td>
        <td style="white-space:nowrap;text-align:right">
          <div style="display:flex;gap:4px;justify-content:flex-end">
            ${isRunning
              ? `<button class="btn btn-xs btn-red"   onclick="dockerAction('${c.ID}','stop')">■ Stop</button>
                 <button class="btn btn-xs"           onclick="dockerAction('${c.ID}','restart')">↺</button>`
              : `<button class="btn btn-xs btn-green" onclick="dockerAction('${c.ID}','start')">▶ Start</button>
                 <button class="btn btn-xs btn-red"   onclick="dockerRemoveContainer('${c.ID}','${(c.Names||'').replace(/'/g,"\\'")}')">✕</button>`
            }
            <button class="btn btn-xs" onclick="dockerToggleLog('${c.ID}','${(c.Names||c.ID.slice(0,12)).replace(/'/g,"\\'")}')">📋 Logs</button>
          </div>
        </td>
      </tr>`;
    }).join('');
    _dockerRenderPresets();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--red)">${e.message}</td></tr>`;
  }
}

async function dockerAction(id, action) {
  try {
    await apiFetch(`/api/docker/containers/${id}/action`, { method: 'POST', body: { action } });
    setTimeout(dockerLoadContainers, 800);
  } catch (e) { alert(`Error: ${e.message}`); }
}

function dockerRemoveContainer(id, name) {
  appConfirm(`Remove container "${name}"?`, async () => {
    try {
      await apiFetch(`/api/docker/containers/${id}/action`, { method: 'POST', body: { action: 'remove' } });
      setTimeout(dockerLoadContainers, 800);
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

/* ── Container logs ────────────────────────────────────── */
function dockerToggleLog(id, name) {
  const drawer = document.getElementById('docker-log-drawer');
  if (_dockerLogContainerId === id && drawer.style.display !== 'none') {
    dockerCloseLog();
    return;
  }
  dockerCloseLog();
  _dockerLogContainerId = id;
  document.getElementById('docker-log-label').textContent = `Logs: ${name}`;
  drawer.style.display = 'flex';
  drawer.style.flexDirection = 'column';

  const out = document.getElementById('docker-log-out');
  out.textContent = '';

  _dockerLogSrc = new EventSource(`/api/docker/containers/${encodeURIComponent(id)}/logs`);
  _dockerLogSrc.onmessage = e => {
    try {
      const line = JSON.parse(e.data);
      out.textContent += line;
      out.scrollTop = out.scrollHeight;
    } catch {}
  };
  _dockerLogSrc.onerror = () => {
    out.textContent += '\n[stream disconnected]';
    _dockerLogSrc?.close();
    _dockerLogSrc = null;
  };
}

function dockerCloseLog() {
  _dockerLogSrc?.close();
  _dockerLogSrc = null;
  _dockerLogContainerId = null;
  const drawer = document.getElementById('docker-log-drawer');
  if (drawer) drawer.style.display = 'none';
  const out = document.getElementById('docker-log-out');
  if (out) out.textContent = '';
}

/* ── Images ────────────────────────────────────────────── */
async function dockerLoadImages() {
  const tbody = document.getElementById('docker-images-body');
  tbody.innerHTML = '<tr><td colspan="5" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/docker/images');
    const images = data.images || [];
    if (!images.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder" style="padding:12px">No images found</td></tr>';
      return;
    }
    tbody.innerHTML = images.map(img => {
      const repo = img.Repository || '<none>';
      const tag  = img.Tag || 'latest';
      const size = img.Size || '—';
      const created = img.CreatedAt ? fmtDate(img.CreatedAt) : (img.CreatedSince || '—');
      const fullId = img.ID || '';
      return `<tr class="models-row">
        <td class="models-name" style="font-size:11px">${repo}</td>
        <td style="font-size:10px">${tag}</td>
        <td style="font-size:10px;color:var(--muted)">${size}</td>
        <td style="font-size:10px;color:var(--muted)">${created}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-xs btn-green" onclick="dockerRunImage('${repo}','${tag}')">▶ Run</button>
          <button class="btn btn-xs btn-red" onclick="dockerRemoveImage('${fullId}','${repo}:${tag}')">✕ Remove</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--red)">${e.message}</td></tr>`;
  }
}

function dockerRemoveImage(id, name) {
  appConfirm(`Remove image "${name}"?`, async () => {
    try {
      await apiFetch(`/api/docker/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
      dockerLoadImages();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

function dockerPullImage() {
  const name = document.getElementById('docker-pull-input')?.value.trim();
  if (!name) return;
  const out = document.getElementById('docker-pull-out');
  out.style.display = 'block';
  out.textContent = `Pulling ${name}…\n`;

  fetch('/api/docker/images/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(res => {
    streamToEl(res, out, () => {
      out.textContent += '\n✓ Done';
      setTimeout(dockerLoadImages, 500);
    });
  }).catch(e => { out.textContent += `\nError: ${e.message}`; });
}

/* ── Run container from image ─────────────────────────── */

let _dockerRunImageRef = '';

function dockerRunImage(repo, tag) {
  const image = (repo === '<none>') ? tag : `${repo}:${tag}`;
  _dockerRunImageRef = image;

  document.getElementById('docker-run-image-label').textContent = image;
  document.getElementById('docker-run-name').value = repo.replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^-+|-+$/g, '');
  document.getElementById('docker-run-ports').value = '';
  document.getElementById('docker-run-gpu').value = '';
  document.getElementById('docker-run-restart').value = 'unless-stopped';
  document.getElementById('docker-run-env').value = '';
  document.getElementById('docker-run-volumes').value = '';
  document.getElementById('docker-run-out').style.display = 'none';
  document.getElementById('docker-run-out').textContent = '';
  document.getElementById('docker-run-ok').disabled = false;

  document.getElementById('docker-run-modal').classList.add('open');
}

function dockerRunClose() {
  document.getElementById('docker-run-modal').classList.remove('open');
}

function _dockerCollectForm() {
  const image   = _dockerRunImageRef;
  const name    = document.getElementById('docker-run-name').value.trim();
  const portsRaw = document.getElementById('docker-run-ports').value.trim();
  const gpu     = document.getElementById('docker-run-gpu').value;
  const restart = document.getElementById('docker-run-restart').value;
  const envRaw  = document.getElementById('docker-run-env').value.trim();
  const volRaw  = document.getElementById('docker-run-volumes').value.trim();

  const ports   = portsRaw ? portsRaw.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : [];
  const envVars = envRaw   ? envRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const volumes = volRaw   ? volRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];

  return { image, name, ports, gpu, restart, envVars, volumes };
}

async function _dockerSavePreset(form) {
  const preset = {
    image: form.image,
    name: form.name,
    ports: form.ports,
    gpu: form.gpu,
    restart: form.restart,
    envVars: form.envVars,
    volumes: form.volumes,
  };
  await apiFetch('/api/docker/presets', { method: 'POST', body: preset });
}

function dockerRunSaveOnly() {
  const form = _dockerCollectForm();
  if (!form.name) { alert('Container name is required to save.'); return; }
  _dockerSavePreset(form)
    .then(() => { dockerRunClose(); dockerLoadPresets(); })
    .catch(e => alert(`Save error: ${e.message}`));
}

function dockerRunSaveAndRun() {
  const form = _dockerCollectForm();
  if (!form.name) { alert('Container name is required to save.'); return; }
  _dockerSavePreset(form).catch(() => {});
  _dockerExecuteRun(form, false);
}

function dockerRunSubmit() {
  const form = _dockerCollectForm();
  _dockerExecuteRun(form, false);
}

function _dockerExecuteRun(form, createOnly) {
  const out = document.getElementById('docker-run-out');
  const okBtn = document.getElementById('docker-run-ok');
  out.style.display = 'block';
  out.textContent = `${createOnly ? 'Creating' : 'Starting'} ${form.image}…\n`;
  okBtn.disabled = true;

  fetch('/api/docker/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: form.image, name: form.name, ports: form.ports, gpu: form.gpu,
      restart: form.restart, envVars: form.envVars, volumes: form.volumes, createOnly
    })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const read = () => {
      reader.read().then(({ done, value }) => {
        if (done) { okBtn.disabled = false; return; }
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(part => {
          const line = part.trim().replace(/^data:\s*/, '');
          if (!line) return;
          try {
            const obj = JSON.parse(line);
            if (obj.status) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
            if (obj.done) {
              okBtn.disabled = false;
              if (obj.ok) {
                setTimeout(() => { dockerRunClose(); dockerLoadContainers(); dockerLoadPresets(); }, 800);
              }
            }
          } catch {}
        });
        read();
      });
    };
    read();
  }).catch(e => {
    out.textContent += `\nError: ${e.message}`;
    okBtn.disabled = false;
  });
}

function _dockerEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

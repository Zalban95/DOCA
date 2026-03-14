/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — DOCKER TAB
   ═══════════════════════════════════════════════════════ */

let _dockerLogSrc = null;
let _dockerLogContainerId = null;

function dockerInit() {
  dockerLoadContainers();
  dockerLoadImages();
}

/* ── Containers ────────────────────────────────────────── */
async function dockerLoadContainers() {
  const tbody = document.getElementById('docker-containers-body');
  tbody.innerHTML = '<tr><td colspan="5" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data = await apiFetch('/api/docker/containers');
    const containers = data.containers || [];
    if (!containers.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder" style="padding:12px">No containers found</td></tr>';
      return;
    }
    tbody.innerHTML = containers.map(c => {
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
        <td style="text-align:right">
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

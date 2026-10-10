/* ══════════════════════════════════════════════════════════
   HuggingFace Models
   ══════════════════════════════════════════════════════════ */

function hfInit() {
  hfLoadSettings();
  hfCheckStatus();
  hfLoadList();
}

async function hfLoadSettings() {
  try {
    const s = await apiFetch('/api/models/hf/settings');
    const cacheEl = document.getElementById('hf-cache-dir');
    const tokenEl = document.getElementById('hf-token');
    if (cacheEl) cacheEl.value = s.cacheDir || '';
    if (tokenEl) tokenEl.value = s.token    || '';
  } catch {}
}

async function hfSaveSettings() {
  const status   = document.getElementById('hf-settings-status');
  const cacheDir = document.getElementById('hf-cache-dir')?.value.trim() || '';
  const token    = document.getElementById('hf-token')?.value.trim()    || '';
  try {
    await apiFetch('/api/models/hf/settings', { method: 'POST', body: { cacheDir, token } });
    setStatus(status, '✓ Saved', 'ok');
    hfCheckStatus();
    hfLoadList();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

async function hfCheckStatus() {
  const badge = document.getElementById('hf-status-badge');
  const installBtn = document.getElementById('hf-install-btn');
  if (!badge) return;
  badge.textContent = '…'; badge.className = 'badge badge-blue';
  let detected = false;
  try {
    const s = await apiFetch('/api/models/hf/status');
    detected = !!s.detected;
    if (s.detected) {
      const label = s.user ? `● ${s.user}  v${s.version}` : `● CLI v${s.version}`;
      badge.textContent = label;
      badge.className   = 'badge badge-green';
    } else {
      badge.textContent = '○ huggingface-cli not found';
      badge.className   = 'badge badge-red';
    }
  } catch {
    badge.textContent = '○ Error'; badge.className = 'badge badge-red';
  }
  if (installBtn) installBtn.style.display = detected ? 'none' : '';
}

function hfInstallCli() {
  const out = document.getElementById('hf-install-out');
  systemToolInstall('huggingface-cli', out, () => setTimeout(() => { hfCheckStatus(); hfLoadList(); }, 1000));
}

async function hfSearch() {
  const q = document.getElementById('hf-search-input')?.value.trim();
  if (!q) return askFor(document.getElementById('hf-search-input'), 'Type what to look for, e.g. whisper or llama.');
  const box = document.getElementById('hf-search-results');
  if (box) { box.style.display = 'block'; box.innerHTML = '<div class="placeholder pulse" style="padding:8px">Searching…</div>'; }
  try {
    const data    = await apiFetch(`/api/models/hf/search?q=${encodeURIComponent(q)}`);
    const results = data.results || [];
    if (!results.length) {
      if (box) box.innerHTML = '<div class="placeholder" style="padding:8px">No results</div>';
      return;
    }
    if (box) box.innerHTML = results.map(m => `
      <div class="models-search-item" onclick="hfSearchSelect(${jsArg(m.id)})">
        <span class="models-search-name">${escHtml(m.id)}</span>
        <span class="models-search-desc">${m.pipeline_tag ? escHtml(m.pipeline_tag) + '  ·  ' : ''}⬇ ${fmtNumber(m.downloads)}  ♥ ${fmtNumber(m.likes)}</span>
      </div>`).join('');
  } catch (e) {
    if (box) box.innerHTML = `<div class="placeholder" style="color:var(--red);padding:8px">${escHtml(e.message)}</div>`;
  }
}

function hfSearchSelect(repoId) {
  const inp = document.getElementById('hf-dl-input');
  if (inp) inp.value = repoId;
  const box = document.getElementById('hf-search-results');
  if (box) box.style.display = 'none';
}

async function hfLoadList() {
  const tbody = document.getElementById('hf-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="placeholder pulse" style="padding:12px">Loading…</td></tr>';
  try {
    const data  = await apiFetch('/api/models/hf/list');
    const repos = data.repos || [];
    const totalEl = document.getElementById('hf-total');
    if (totalEl) {
      const totalBytes = repos.reduce((s, r) => s + (r.size_on_disk || 0), 0);
      totalEl.textContent = repos.length ? `· ${repos.length} repo${repos.length > 1 ? 's' : ''} · ${fmtBytes(totalBytes)} on disk` : '';
    }
    if (!repos.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder" style="padding:12px">No cached models found</td></tr>';
      return;
    }
    tbody.innerHTML = repos.map(r => {
      const size   = r.size_on_disk ? fmtBytes(r.size_on_disk) : '—';
      const date   = r.last_modified ? fmtDate(r.last_modified) : '—';
      const parts  = r.repo_id.split('/');
      const org    = parts.length > 1 ? parts[0] : '';
      const name   = parts.length > 1 ? parts.slice(1).join('/') : r.repo_id;
      return `<tr class="models-row">
        <td class="models-name" title="${escHtml(r.repo_id)}">
          ${org ? `<span style="opacity:.5;font-size:10px">${escHtml(org)}/</span>` : ''}${escHtml(name)}
        </td>
        <td class="models-size">${escHtml(r.repo_type || 'model')}</td>
        <td class="models-size">${escHtml(size)}</td>
        <td class="models-date">${escHtml(date)}</td>
        <td class="models-acts">
          <button class="btn btn-xs btn-red" onclick="hfDelete(${jsArg(r.repo_id)})">✕ Delete</button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--red)">${escHtml(e.message)}</td></tr>`;
  }
}

function hfDownload() {
  const repoId = document.getElementById('hf-dl-input')?.value.trim();
  if (!repoId) return;

  const out    = document.getElementById('hf-dl-out');
  const bar    = document.getElementById('hf-pull-bar');
  const barFil = document.getElementById('hf-pull-bar-fill');
  const pct    = document.getElementById('hf-pull-pct');

  if (out)    { out.style.display = 'block'; out.textContent = ''; }
  if (bar)    bar.style.display = 'block';
  if (barFil) barFil.style.width = '0%';
  if (pct)    pct.textContent = '';

  let _hfLines = [];

  sseStream('/api/models/hf/download', { repoId }, {
    onStatus: status => {
      if (!out) return;
      // \r-aware line rewriting so progress bars redraw in place
      const chunks = status.split('\r');
      chunks.forEach((chunk, i) => {
        if (i > 0) {
          _hfLines[_hfLines.length - 1] = chunk;
        } else {
          const newlines = chunk.split('\n');
          if (_hfLines.length)
            _hfLines[_hfLines.length - 1] += newlines[0];
          else
            _hfLines.push(newlines[0]);
          for (let j = 1; j < newlines.length; j++)
            _hfLines.push(newlines[j]);
        }
      });
      const maxVisible = 200;
      const visible = _hfLines.length > maxVisible
        ? _hfLines.slice(-maxVisible) : _hfLines;
      out.textContent = visible.join('\n');
      out.scrollTop = out.scrollHeight;

      const pctMatches = status.match(/(\d+)%/g);
      if (pctMatches) {
        const p = parseInt(pctMatches[pctMatches.length - 1]);
        if (barFil) barFil.style.width = `${p}%`;
        if (pct)    pct.textContent    = `${p}%`;
      }
    },
    onDone: () => {
      if (bar)  bar.style.display = 'none';
      if (pct)  pct.textContent = '';
      setTimeout(() => { hfLoadList(); modelsLoadDisk(true); }, 1000);
    },
    onError: e => { if (out) out.textContent += `Error: ${e.message}\n`; },
  }).then(() => { if (bar) bar.style.display = 'none'; });
}

function hfDelete(repoId) {
  appConfirm(`Delete the cached “${repoId}”? Its files go from the Hugging Face cache; it is downloaded again the next time something needs it.`, async () => {
    try {
      await apiFetch('/api/models/hf/delete', { method: 'POST', body: { repoId } });
      hfLoadList();
      modelsLoadDisk(true);
    } catch (e) { appAlert(`Delete error: ${e.message}`); }
  });
}

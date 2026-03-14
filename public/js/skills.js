/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SKILLS (installed + online search)
   ═══════════════════════════════════════════════════════ */

let allSkills    = [];
let skillsMode   = 'installed'; // 'installed' | 'search'

/* ── Mode toggle ─────────────────────────────────────── */
function skillsSetMode(mode) {
  skillsMode = mode;
  document.getElementById('skills-mode-installed').classList.toggle('active', mode === 'installed');
  document.getElementById('skills-mode-search').classList.toggle('active', mode === 'search');
  document.getElementById('skills-installed-bar').style.display = mode === 'installed' ? 'flex' : 'none';
  document.getElementById('skills-search-bar').style.display    = mode === 'search'    ? 'flex' : 'none';

  if (mode === 'installed') {
    renderSkills(allSkills);
  } else {
    document.getElementById('skills-grid').innerHTML =
      '<div class="placeholder">Enter a query above and press Search</div>';
  }
}

/* ── Installed skills ────────────────────────────────── */
async function loadSkills() {
  const grid = document.getElementById('skills-grid');
  grid.innerHTML = '<div class="placeholder pulse">Loading…</div>';
  try {
    const data = await apiFetch('/api/skills');
    allSkills  = data.skills || [];
    renderSkills(allSkills);
  } catch (e) {
    grid.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function renderSkills(skills) {
  if (skillsMode !== 'installed') return;
  const grid = document.getElementById('skills-grid');
  if (!skills.length) {
    grid.innerHTML = '<div class="placeholder">No skills installed</div>';
    return;
  }
  grid.innerHTML = skills.map(s => `
    <div class="skill-card fade-in ${s.enabled ? '' : 'disabled'}">
      <div class="skill-card-header">
        <div class="skill-card-name" title="${s.name}">${s.name}</div>
        <label class="skill-toggle" title="${s.enabled ? 'Disable' : 'Enable'}">
          <input type="checkbox" ${s.enabled ? 'checked' : ''}
                 onchange="toggleSkill('${s.name}', this.checked)">
          <span class="skill-toggle-track"></span>
        </label>
      </div>
      ${s.version ? `<div class="skill-card-ver">v${s.version}</div>` : ''}
      <div class="skill-card-desc">${s.description || '—'}</div>
      <div class="skill-card-footer">
        <button class="skill-card-action" onclick="showSkillDetail('${s.name}')">Details</button>
        <button class="skill-card-del" onclick="removeSkill('${s.name}')">✕ remove</button>
      </div>
    </div>
  `).join('');
}

function filterSkills() {
  const q = (document.getElementById('skill-filter').value || '').toLowerCase().trim();
  if (!q) { renderSkills(allSkills); return; }
  renderSkills(allSkills.filter(s =>
    s.name.toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q)
  ));
}

/* ── Online search ───────────────────────────────────── */
async function searchSkillsOnline() {
  const q    = (document.getElementById('skill-search-input').value || '').trim();
  const grid = document.getElementById('skills-grid');
  if (!q) return;

  grid.innerHTML = '<div class="placeholder pulse">Searching…</div>';

  try {
    const data    = await apiFetch(`/api/skills/search?q=${encodeURIComponent(q)}`);
    let results   = data.results || [];

    // Apply flag filters
    const wantOfficial  = document.getElementById('flag-official').checked;
    const wantCommunity = document.getElementById('flag-community').checked;
    const wantUnknown   = document.getElementById('flag-unknown').checked;
    const anyFlag       = wantOfficial || wantCommunity || wantUnknown;

    if (anyFlag) {
      results = results.filter(r => {
        if (wantOfficial  && r.official)                     return true;
        if (wantCommunity && r.community)                    return true;
        if (wantUnknown   && !r.official && !r.community)    return true;
        return false;
      });
    }

    const viaNote = data.via === 'github'
      ? '<div style="font-size:10px;color:var(--muted);margin-bottom:8px">Results via GitHub search (clawhub CLI not available)</div>'
      : '';

    if (data.error || !results.length) {
      grid.innerHTML = viaNote + `<div class="placeholder">${data.error || 'No results found'}</div>`;
      return;
    }

    const installed = new Set(allSkills.map(s => s.name));
    const cards = results.map(s => {
      const nameEsc = s.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const urlLink = s.url ? `<a href="${s.url}" target="_blank" style="font-size:9px;color:var(--blue)">${s.stars ? '★ ' + s.stars : 'View'}</a>` : '';
      return `
        <div class="skill-card fade-in">
          <div class="skill-card-header">
            <div class="skill-card-name" title="${nameEsc}">${s.name}</div>
            <div class="skill-trust-badges">${_skillTrustBadge(s)}</div>
          </div>
          ${s.version ? `<div class="skill-card-ver">v${s.version}</div>` : ''}
          <div class="skill-card-desc">${s.description || '—'}</div>
          <div class="skill-card-footer">
            ${installed.has(s.name)
              ? `<span class="badge badge-green" style="font-size:9px">Installed</span>`
              : `<button class="skill-card-action" onclick="skillsInstallFromSearch('${nameEsc}', ${!s.official && !s.community})">Install</button>`
            }
            ${urlLink}
            <span style="font-size:9px;color:var(--muted)">${s.source || ''}</span>
          </div>
        </div>
      `;
    }).join('');
    grid.innerHTML = viaNote + cards;
  } catch (e) {
    grid.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function _skillTrustBadge(s) {
  if (s.official)  return '<span class="badge badge-green"  style="font-size:9px">Official</span>';
  if (s.community) return '<span class="badge badge-blue"   style="font-size:9px">Community</span>';
  return '<span class="badge" style="font-size:9px;background:var(--dim);color:var(--muted)">Unknown source</span>';
}

function skillsInstallFromSearch(name, isUnknown) {
  const doInstall = () => {
    skillsSetMode('installed');
    document.getElementById('skill-input').value = name;
    installSkill(false);
  };
  if (isUnknown) {
    appConfirm(`"${name}" is from an unknown/unverified source.\nInstall anyway?`, doInstall);
  } else {
    doInstall();
  }
}

/* ── Install / Toggle / Detail / Remove ─────────────── */
async function toggleSkill(name, enable) {
  try {
    await apiFetch(`/api/skills/${name}/toggle`, { method: 'POST' });
    loadSkills();
  } catch (e) { alert(`Toggle error: ${e.message}`); loadSkills(); }
}

async function showSkillDetail(name) {
  const overlay = document.getElementById('skill-detail-overlay');
  const title   = document.getElementById('skill-detail-title');
  const body    = document.getElementById('skill-detail-body');

  title.textContent = name;
  body.innerHTML = '<div class="placeholder pulse">Loading…</div>';
  overlay.style.display = 'flex';

  try {
    const data = await apiFetch(`/api/skills/${name}`);
    let html = '';

    html += `<div class="skill-detail-meta">`;
    html += `<span class="badge ${data.enabled ? 'badge-green' : 'badge-red'}">${data.enabled ? 'ENABLED' : 'DISABLED'}</span>`;
    if (data.version) html += ` <span class="badge badge-blue">v${data.version}</span>`;
    html += `</div>`;

    if (data.description) {
      html += `<p style="color:var(--text);font-size:12px;margin:10px 0">${data.description}</p>`;
    }

    if (data.readme) {
      html += `<div class="skill-detail-section">README</div>`;
      html += `<pre class="skill-detail-readme">${escapeHtml(data.readme)}</pre>`;
    }

    if (data.files && data.files.length) {
      html += `<div class="skill-detail-section">Files (${data.files.length})</div>`;
      html += `<div class="skill-detail-files">`;
      data.files.forEach(f => {
        const icon = f.isDir ? '📁' : '📄';
        const size = f.isDir ? '' : fmtBytes(f.size);
        html += `<div class="skill-detail-file"><span>${icon} ${f.name}</span><span class="text-muted">${size}</span></div>`;
      });
      html += `</div>`;
    }

    html += `<div style="margin-top:12px;font-size:10px;color:var(--muted)">Path: ${data.path}</div>`;
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function closeSkillDetail(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('skill-detail-overlay').style.display = 'none';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function installSkill(force) {
  const name = document.getElementById('skill-input').value.trim();
  if (!name) return;
  const out = document.getElementById('install-out');
  out.textContent = '';
  out.style.display = 'block';

  fetch('/api/skills/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill: name, force })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) { loadSkills(); return; }
        decoder.decode(value).split('\n').forEach(line => {
          if (line.startsWith('data: ')) {
            try { out.textContent += JSON.parse(line.slice(6)); } catch {}
          }
        });
        out.scrollTop = out.scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => { out.textContent += `\nError: ${e.message}`; });
}

function removeSkill(name) {
  appConfirm(`Remove skill: ${name}?`, async () => {
    try {
      await apiFetch(`/api/skills/${name}`, { method: 'DELETE' });
      loadSkills();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

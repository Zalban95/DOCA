/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SETTINGS TAB
   ═══════════════════════════════════════════════════════ */

const SETTINGS_TABS = [
  { id: 'controls',  label: 'Controls' },
  { id: 'logs',      label: 'Logs' },
  { id: 'keys',      label: 'API Keys' },
  { id: 'skills',    label: 'Skills' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'setup',     label: 'Setup' },
  { id: 'config',    label: 'Config' },
  { id: 'files',     label: 'Files' },
  { id: 'code',      label: 'Code' },
  { id: 'terminal',  label: 'Terminal' },
  { id: 'models',    label: 'Models' },
  { id: 'docker',    label: 'Docker' },
];

let _settingsHidden = [];

async function settingsInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _settingsRender();
  } catch (e) {
    const el = document.getElementById('settings-tabs-list');
    if (el) el.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
  sysdepsLoad();
}

function _settingsRender() {
  const list = document.getElementById('settings-tabs-list');
  if (!list) return;
  list.innerHTML = SETTINGS_TABS.map(t => `
    <div class="settings-tab-row">
      <label class="skill-toggle">
        <input type="checkbox" id="settings-show-${t.id}"
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}>
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">${t.label}</span>
    </div>
  `).join('');
}

async function settingsSave() {
  const status = document.getElementById('settings-status');
  const hiddenTabs = SETTINGS_TABS
    .filter(t => !document.getElementById(`settings-show-${t.id}`)?.checked)
    .map(t => t.id);

  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { hiddenTabs } });
    setStatus(status, '✓ Saved — reload to apply', 'ok');
    _settingsHidden = hiddenTabs;
    _applyHiddenTabs(hiddenTabs);
    // Sync the quick menu panel
    _sidebarTabTogglesRender();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _applyHiddenTabs(hiddenTabs) {
  document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'settings') return;
    btn.style.display = hiddenTabs.includes(tab) ? 'none' : '';
  });
}

/* Called on app startup to apply persisted hidden tabs */
async function settingsApplyOnLoad() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _applyHiddenTabs(_settingsHidden);
  } catch {}
}

/* ── Sidebar quick tab-toggle panel ──────────────────── */

let _sidebarTabPanelOpen = false;

function sidebarTabTogglesOpen() {
  _sidebarTabPanelOpen = !_sidebarTabPanelOpen;
  const panel = document.getElementById('sidebar-tab-panel');
  if (!panel) return;
  panel.style.display = _sidebarTabPanelOpen ? 'block' : 'none';
  if (_sidebarTabPanelOpen) _sidebarTabTogglesRender();
}

function _sidebarTabTogglesRender() {
  const list = document.getElementById('sidebar-tab-toggles');
  if (!list) return;
  list.innerHTML = SETTINGS_TABS.map(t => `
    <div class="sidebar-tab-toggle-row">
      <label class="skill-toggle" style="transform:scale(0.8);transform-origin:left center">
        <input type="checkbox" id="stb-${t.id}"
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}
               onchange="sidebarTabToggleChange('${t.id}', this.checked)">
        <span class="skill-toggle-track"></span>
      </label>
      <span style="font-size:11px">${t.label}</span>
    </div>
  `).join('');
}

/* ── System Tools (sysdeps) ──────────────────────────── */

const SYSDEP_CATEGORY_LABEL = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
const SYSDEP_CATEGORY_COLOR = { required: 'var(--red)', recommended: 'var(--amber)', optional: 'var(--muted)' };

let _sysdepsInstalling = null; // tool id currently installing

async function sysdepsLoad() {
  const list   = document.getElementById('sysdeps-list');
  const btn    = document.getElementById('sysdeps-refresh-btn');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Checking…</div>';
  if (btn) btn.disabled = true;
  try {
    const data  = await apiFetch('/api/system/tools');
    _sysdepsRender(data.tools || []);
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function sysdepsRefresh() { sysdepsLoad(); }

function _sysdepsRender(tools) {
  const list = document.getElementById('sysdeps-list');
  if (!list) return;

  // Group by category
  const cats = ['required', 'recommended', 'optional'];
  let html = '';

  cats.forEach(cat => {
    const group = tools.filter(t => t.category === cat);
    if (!group.length) return;

    html += `<div class="sysdep-group-label" style="color:${SYSDEP_CATEGORY_COLOR[cat]}">${SYSDEP_CATEGORY_LABEL[cat]}</div>`;
    html += group.map(t => {
      const statusIcon  = t.detected ? '✓' : '✗';
      const statusClass = t.detected ? 'sysdep-ok' : 'sysdep-missing';
      const versionStr  = t.detected && t.version ? `<span class="sysdep-version">${_escHtml(t.version)}</span>` : '';
      const installBtn  = !t.detected && t.canInstall
        ? `<button class="btn btn-xs btn-teal" onclick="sysdepsInstall('${t.id}')" ${_sysdepsInstalling === t.id ? 'disabled' : ''}>
             ${_sysdepsInstalling === t.id ? '⏳ Installing…' : '⬇ Install'}
           </button>`
        : '';
      const repoLink = !t.detected
        ? `<a class="sysdep-repo" href="${t.repo}" target="_blank" title="${t.repo}">${_escHtml(t.repoLabel || t.repo)}</a>`
        : '';
      const manualNote = !t.detected && !t.canInstall
        ? `<span class="sysdep-manual">manual install required</span>`
        : '';

      return `<div class="sysdep-row ${statusClass}">
        <span class="sysdep-status">${statusIcon}</span>
        <span class="sysdep-label">${_escHtml(t.label)}</span>
        ${versionStr}
        <span class="sysdep-note">${_escHtml(t.note || '')}</span>
        <span class="sysdep-actions">${installBtn}${repoLink}${manualNote}</span>
      </div>`;
    }).join('');
  });

  list.innerHTML = html;
}

async function sysdepsInstall(id) {
  _sysdepsInstalling = id;
  _sysdepsRender([]); // will reload below — optimistically mark as installing via a targeted update
  // Re-fetch to get full list then re-render with installing flag
  try { const d = await apiFetch('/api/system/tools'); _sysdepsRender(d.tools || []); } catch {}

  const out = document.getElementById('sysdeps-out');
  if (out) { out.style.display = 'block'; out.textContent = `Installing ${id}…\n`; }

  try {
    const res = await fetch('/api/system/tools/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    const read    = async () => {
      const { done, value } = await reader.read();
      if (done) return;
      decoder.decode(value).split('\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.status && out) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
          if (obj.done) {
            _sysdepsInstalling = null;
            // Re-check all tools after install
            setTimeout(sysdepsLoad, 800);
          }
        } catch {}
      });
      await read();
    };
    await read();
  } catch (e) {
    if (out) out.textContent += `\nError: ${e.message}`;
    _sysdepsInstalling = null;
    setTimeout(sysdepsLoad, 500);
  }
}

function _escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Sidebar quick tab-toggle panel ──────────────────── */

async function sidebarTabToggleChange(tabId, visible) {
  if (visible) {
    _settingsHidden = _settingsHidden.filter(id => id !== tabId);
  } else {
    if (!_settingsHidden.includes(tabId)) _settingsHidden.push(tabId);
  }
  _applyHiddenTabs(_settingsHidden);
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { hiddenTabs: _settingsHidden } });
  } catch {}
  // Sync settings tab if open
  const el = document.getElementById(`settings-show-${tabId}`);
  if (el) el.checked = visible;
}

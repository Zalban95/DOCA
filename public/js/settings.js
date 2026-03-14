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

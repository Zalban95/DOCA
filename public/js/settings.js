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
  // #region agent log
  fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'settings.js:settingsInit',message:'settingsInit called',data:{listEl:!!document.getElementById('settings-tabs-list')},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
  // #endregion
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    // #region agent log
    fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'settings.js:settingsInit-prefsFetched',message:'prefs fetched OK',data:{hiddenTabs:prefs.hiddenTabs},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    _settingsRender();
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7404/ingest/a169e71a-1553-42cd-9c71-de52063f68ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e82941'},body:JSON.stringify({sessionId:'e82941',location:'settings.js:settingsInit-error',message:'settingsInit error',data:{err:e.message},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    document.getElementById('settings-tabs-list').innerHTML =
      `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function _settingsRender() {
  const list = document.getElementById('settings-tabs-list');
  if (!list) return;
  list.innerHTML = SETTINGS_TABS.map(t => `
    <div class="settings-tab-row">
      <label class="settings-tab-toggle">
        <input type="checkbox" id="settings-show-${t.id}"
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}>
        <span class="skill-toggle-track"></span>
        <span class="settings-tab-label">${t.label}</span>
      </label>
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
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _applyHiddenTabs(hiddenTabs) {
  document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'settings') return; // never hide the Settings tab itself
    btn.style.display = hiddenTabs.includes(tab) ? 'none' : '';
  });
}

/* Called on app startup to apply persisted hidden tabs */
async function settingsApplyOnLoad() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _applyHiddenTabs(prefs.hiddenTabs || []);
  } catch {}
}

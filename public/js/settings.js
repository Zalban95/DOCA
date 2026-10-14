/* ═══════════════════════════════════════════════════════
   SETTINGS TAB — sub-navigation, General (tabs, theme, sidebar), Voice, System
   ═══════════════════════════════════════════════════════ */

const SETTINGS_TABS = [
  { id: 'controls',  label: 'Overview' },
  { id: 'logs',      label: 'Logs' },
  { id: 'files',     label: 'Files' },
  { id: 'projects',  label: 'Projects' },
  { id: 'harness',   label: 'Harness' },
  { id: 'computers', label: 'Computers' },
  { id: 'terminal',  label: 'Terminal' },
  { id: 'models',    label: 'Models' },
  { id: 'docker',    label: 'Docker' },
  { id: 'vms',       label: 'VMs' },
  { id: 'mcp',       label: 'MCP' },
];

let _settingsHidden = [];

/** The pages this hive has, to show or hide: an unlicensed page (lib/licence.js) or one absent here is left out. */
const _settingsTabsHere = () => SETTINGS_TABS.filter(t => (typeof licencePageOn !== 'function' || licencePageOn(t.id))
  && (typeof NAV_TABS === 'undefined' || NAV_TABS.includes(t.id)));

async function _subtabGeneralInit() {
  try {
    if (typeof licenceReady === 'function') await licenceReady();
    const prefs = await screenPrefs();   // this screen's look, tabs and sections over the hive's (lib/screen.js)
    _settingsHidden = prefs.hiddenTabs || [];
    _settingsRender();
    _lookPickerRender(prefs);
    _themePickerRender(prefs);
    faceSettingsRender();   // the face: in this screen's corner, or full screen (face/corner.js)
    screenSettingsNote();   // these are this screen's own (lib/screen.js)
    if (typeof yourPanelCard === 'function') yourPanelCard();   // the panel's layout as the person's data (settings/your-panel.js)
    if (typeof chatNotifyCard === 'function') chatNotifyCard();   // which hive-chat messages reach my devices (settings/chat-notify.js)
    _statsSettingsRender(prefs);
  } catch (e) {
    const el = document.getElementById('settings-tabs-list');
    if (el) el.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
  updateCheck();
  startupLoad();
}

function _subtabSystemInit() {
  hostCapsLoad();
  if (typeof networkCard === 'function') networkCard();   // who can reach the hub (settings/network.js)
  if (typeof servicesLifeCard === 'function') servicesLifeCard();   // stopping services nothing uses (settings/services-life.js)
  pathsLoad();
  sysdepsLoad();
  checkpointsRender();   // settings checkpoints (settings/checkpoints.js)
  logKeepCard();         // what is kept of what happened, and its bounds (settings/log-keep.js)
  featuresRender();      // every feature, and the kept alternatives' use (settings/features.js)
  licenceCard();         // the licence: what this hive runs, renewing it (settings/licence.js) — drawn first in System
}

async function _subtabVoiceInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _voiceSettingsLoad(prefs);
  } catch {}
  // In order — the Voice card first (how answers are spoken, each call's voice, which services run;
  // settings/voice-card.js), the hive's speech services, then the call's cards (settings/live-call.js).
  await voiceCardRender();
  await liveCallRender();
}

function _settingsRender() {
  const list = document.getElementById('settings-tabs-list');
  if (!list) return;
  list.innerHTML = advancedFold(_settingsTabsHere().map(t => `
    <div class="settings-tab-row">
      <label class="skill-toggle">
        <input type="checkbox" id="settings-show-${t.id}" data-default="true" data-label="${escHtml(t.label)}"
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}
               onchange="settingsSave()">
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">${t.label}</span>
    </div>
  `).join(''), { id: 'general-tabs', label: 'Which pages show' });   // every page shows until hidden: a hidden one marks the fold
}

/** Saves on every toggle, like the sidebar stats next to it — a checkbox that
 *  silently does nothing until you find a Save button is a trap. */
async function settingsSave() {
  const status = document.getElementById('settings-status');
  const here = _settingsTabsHere();
  // A page not drawn here keeps what was saved for it: it is not here to be shown or hidden.
  const hiddenTabs = [...here.filter(t => !document.getElementById(`settings-show-${t.id}`)?.checked).map(t => t.id),
    ..._settingsHidden.filter(id => !here.some(t => t.id === id))];

  try {
    await screenSave({ hiddenTabs });
    setStatus(status, '✓ Saved', 'ok');
    _settingsHidden = hiddenTabs;
    _applyHiddenTabs(hiddenTabs);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _applyHiddenTabs(list) {
  const hiddenTabs = [...list, ...(typeof panelLayoutHidden === 'function' ? panelLayoutHidden() : [])];   // and the layout's (panel-layout.js)
  document.querySelectorAll('.nav-tab[data-tab], .mobile-nav-item[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'settings') return;
    btn.style.display = hiddenTabs.includes(tab) ? 'none' : '';
  });
  if (typeof navGroupsVisibility === 'function') navGroupsVisibility();
}

let _settingsNoHost = false;
/** The hidden tabs again, after the nav was drawn anew (a layout change): Settings → General's, the layout's, the machine's. */
function settingsHiddenApply() { _applyHiddenTabs(_settingsNoHost ? [...new Set([..._settingsHidden, ...HOST_TABS])] : _settingsHidden); }

/* Called on app startup to apply persisted hidden tabs + sidebar sections */
async function settingsApplyOnLoad() {
  try {
    const [prefs] = await Promise.all([screenPrefs(), typeof panelLayoutLoad === 'function' ? panelLayoutLoad() : null, typeof licenceReady === 'function' ? licenceReady() : null]);
    _settingsHidden = prefs.hiddenTabs || [];
    // Without host, the tabs that are the machine are left out instead of drawn as refusals (live test 2026-10-04).
    const me = await apiFetch('/api/auth/me').catch(() => null);
    const noHost = !!me?.rights && !me.rights.includes('host');
    document.body.classList.toggle('no-host', noHost);
    _settingsNoHost = noHost;
    settingsHiddenApply();
    _sidebarSections = prefs.sidebarSections || {};
    applySidebarSections(_sidebarSections);
  } catch {}
  _silentUpdateBadgeCheck();
}

/* ── Sidebar sections + system stats toggles ─────────── */

const SIDEBAR_SECTIONS = [
  { id: 'containers', label: 'Machines' },   // the id predates computers and VMs in it; people's saved choices use it
  { id: 'gpu',        label: 'GPU' },
  { id: 'system',     label: 'System' },
  { id: 'models',     label: 'Ollama Models' },
  { id: 'hfModels',   label: 'HuggingFace Models' },
  { id: 'llamacpp',   label: 'llama.cpp Servers' },
  { id: 'services',   label: 'Inference Services' },
];

/** Show/hide sidebar sections per the visibility map ({} = all visible). */
function applySidebarSections(map) {
  document.querySelectorAll('.sidebar-section[data-section]').forEach(el => {
    const id = el.dataset.section;
    el.style.display = map[id] === false ? 'none' : '';
  });
}

let _statsDefs = []; // cached defs from /api/stats/defs

async function _statsSettingsRender(prefs) {
  const list = document.getElementById('settings-stats-list');
  if (!list) return;
  try {
    const data = await apiFetch('/api/stats/defs');
    _statsDefs = data.defs || [];
    const enabled = data.enabled || {};
    const sections = prefs?.sidebarSections || _sidebarSections || {};

    const toggleRow = (idAttr, checked, label, onchange, byDefault = true) => `
      <div class="settings-tab-row">
        <label class="skill-toggle">
          <input type="checkbox" id="${idAttr}" ${checked ? 'checked' : ''} data-default="${byDefault !== false}" data-label="${label}" onchange="${onchange}">
          <span class="skill-toggle-track"></span>
        </label>
        <span class="settings-tab-label">${label}</span>
      </div>`;

    let html = '<div class="tool-group-label">System stats</div>';
    html += _statsDefs.filter(d => d.group === 'system').map(d =>
      toggleRow(`stat-toggle-${d.id}`, enabled[d.id], escHtml(d.label),
        `statsToggleChange('${d.id}', this.checked)`, d.default)).join('');

    html += '<div class="tool-group-label" style="margin-top:12px">GPU stats</div>';
    html += _statsDefs.filter(d => d.group === 'gpu').map(d =>
      toggleRow(`stat-toggle-${d.id}`, enabled[d.id], escHtml(d.label),
        `statsToggleChange('${d.id}', this.checked)`, d.default)).join('');

    html += '<div class="tool-group-label" style="margin-top:12px">Sidebar sections</div>';
    html += SIDEBAR_SECTIONS.map(s =>
      toggleRow(`section-toggle-${s.id}`, sections[s.id] !== false, escHtml(s.label),
        `sectionToggleChange('${s.id}', this.checked)`)).join('');

    list.innerHTML = advancedFold(html, { id: 'general-stats', label: 'Which stats and sections show' });
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

async function statsToggleChange(id, enabled) {
  const status = document.getElementById('stats-settings-status');
  try {
    const prefs = await apiFetch('/api/prefs');
    const sidebarStats = { ...(prefs.sidebarStats || {}), [id]: enabled };
    await apiFetch('/api/prefs', { method: 'POST', body: { sidebarStats } });
    setStatus(status, '✓ Saved', 'ok');
    pollStatus(); // re-render sidebar with new config immediately
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

async function sectionToggleChange(id, visible) {
  const status = document.getElementById('stats-settings-status');
  _sidebarSections = { ..._sidebarSections, [id]: visible };
  applySidebarSections(_sidebarSections);
  try {
    await screenSave({ sidebarSections: _sidebarSections });
    setStatus(status, '✓ Saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

async function _silentUpdateBadgeCheck() {
  try {
    const data = await apiFetch('/api/update-check');
    const badge = document.getElementById('update-badge');
    if (badge && data.updateAvailable) {
      badge.style.display = 'inline-block';
      badge.title = `Update: v${data.latest} available`;
    }
  } catch {}
}

/* ── Voice Services settings ─────────────────────────── */

function _voiceSettingsLoad(prefs) {
  const vs = prefs?.voiceServices || {};
  const set = (id, val, def) => { const el = document.getElementById(id); if (el) el.value = val || def; };
  set('voice-stt-url',   vs.sttUrl,   'http://localhost:8000');
  set('voice-stt-model', vs.sttModel, 'whisper-1');
  set('voice-tts-url',   vs.ttsUrl,   'http://localhost:8880');
  set('voice-tts-model', vs.ttsModel, 'kokoro');
  set('voice-tts-voice', vs.ttsVoice, 'af_heart');
  const speed = vs.ttsSpeed ?? 1.0;
  set('voice-tts-speed', speed, '1.0');
  const lbl = document.getElementById('voice-tts-speed-val');
  if (lbl) lbl.textContent = speed;
  _voiceServicesChoices();
}

/** Type or pick (lib/choice-input.js): the speech services on this machine, and the models and voices each lists. */
function _voiceServicesChoices() {
  const el = id => document.getElementById(id);
  const ask = (what, urlBox) => async () => apiFetch(`/api/services/choices?what=${what}${urlBox ? `&url=${encodeURIComponent(el(urlBox)?.value.trim() || '')}` : ''}`);
  choiceInputAttach(el('voice-stt-url'), { source: 'this machine', load: ask('stt-url') });
  choiceInputAttach(el('voice-stt-model'), { source: 'the speech-to-text service', load: ask('stt-model', 'voice-stt-url') });
  choiceInputAttach(el('voice-tts-url'), { source: 'this machine', load: ask('tts-url') });
  choiceInputAttach(el('voice-tts-model'), { source: 'the speech service', load: ask('tts-model', 'voice-tts-url') });
  choiceInputAttach(el('voice-tts-voice'), { source: 'the speech service', load: async () => ({ items: (await apiFetch('/api/chat/voices')).voices || [] }) });
  // The service's own default voice and speed: what a screen with no voice of its own hears. The Voice card above is
  // where a voice is chosen, so these two are the few most people never touch.
  const rows = ['voice-tts-voice', 'voice-tts-speed'].map(id => el(id)?.closest('.choice')?.parentElement?.closest('div') || el(id)?.parentElement);
  if (rows[0] && !rows[0].closest('details.adv-fold')) advancedFold(rows, { id: 'voice-services-default', label: 'Its default voice' });
}

async function voiceSettingsSave() {
  const status = document.getElementById('voice-settings-status');
  const voiceServices = {
    sttUrl:   document.getElementById('voice-stt-url')?.value.trim()   || 'http://localhost:8000',
    sttModel: document.getElementById('voice-stt-model')?.value.trim() || 'whisper-1',
    ttsUrl:   document.getElementById('voice-tts-url')?.value.trim()   || 'http://localhost:8880',
    ttsModel: document.getElementById('voice-tts-model')?.value.trim() || 'kokoro',
    ttsVoice: document.getElementById('voice-tts-voice')?.value.trim() || 'af_heart',
    ttsSpeed: parseFloat(document.getElementById('voice-tts-speed')?.value) || 1.0,
  };
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { voiceServices } });
    setStatus(status, '✓ Saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}



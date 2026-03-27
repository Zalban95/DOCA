/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SETTINGS TAB
   ═══════════════════════════════════════════════════════ */

const SETTINGS_TABS = [
  { id: 'controls',  label: 'Controls' },
  { id: 'logs',      label: 'Logs' },
  { id: 'files',     label: 'Files' },
  { id: 'code',      label: 'Code' },
  { id: 'terminal',  label: 'Terminal' },
  { id: 'models',    label: 'Models' },
  { id: 'docker',    label: 'Docker' },
];

const _SETTINGS_SUBTABS = [
  { id: 'general',   label: 'General',   init: '_subtabGeneralInit' },
  { id: 'keys',      label: 'API Keys',  init: 'loadKeys' },
  { id: 'skills',    label: 'Skills',    init: 'loadSkills' },
  { id: 'snapshots', label: 'Snapshots', init: 'loadSnapshots' },
  { id: 'setup',     label: 'Setup',     init: 'loadScripts' },
  { id: 'config',    label: 'Config',    init: 'initConfig' },
  { id: 'voice',     label: 'Voice',     init: '_subtabVoiceInit' },
  { id: 'system',    label: 'System',    init: 'sysdepsLoad' },
];

let _settingsHidden = [];
let _settingsActiveSubtab = 'general';
let _subtabInited = {};

async function settingsInit() {
  settingsSubNav(_settingsActiveSubtab);
}

function settingsSubNav(panelId) {
  _settingsActiveSubtab = panelId;

  document.querySelectorAll('#settings-subnav .settings-subnav-btn').forEach((btn, i) => {
    btn.classList.toggle('active', _SETTINGS_SUBTABS[i]?.id === panelId);
  });

  document.querySelectorAll('#tab-settings .settings-panel').forEach(p => {
    p.classList.toggle('active', p.id === `sp-${panelId}`);
  });

  const entry = _SETTINGS_SUBTABS.find(t => t.id === panelId);
  if (entry && !_subtabInited[panelId]) {
    _subtabInited[panelId] = true;
    const fn = window[entry.init] || this[entry.init];
    if (typeof fn === 'function') fn();
  }
}

async function _subtabGeneralInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _settingsRender();
    _themePickerRender(prefs);
  } catch (e) {
    const el = document.getElementById('settings-tabs-list');
    if (el) el.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
  updateCheck();
}

async function _subtabVoiceInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _voiceSettingsLoad(prefs);
  } catch {}
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
    setStatus(status, '✓ Saved', 'ok');
    _settingsHidden = hiddenTabs;
    _applyHiddenTabs(hiddenTabs);
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
  _silentUpdateBadgeCheck();
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

/* ── System Tools (sysdeps) ──────────────────────────── */

const SYSDEP_CATEGORY_LABEL = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
const SYSDEP_CATEGORY_COLOR = { required: 'var(--red)', recommended: 'var(--amber)', optional: 'var(--muted)' };

let _sysdepsInstalling = null; // tool id currently installing
let _sysdepsTools      = [];   // cached list from last fetch (used by sysdepsInstall)

async function sysdepsLoad() {
  const list   = document.getElementById('sysdeps-list');
  const btn    = document.getElementById('sysdeps-refresh-btn');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Checking…</div>';
  if (btn) btn.disabled = true;
  try {
    const data  = await apiFetch('/api/system/tools');
    _sysdepsTools = data.tools || [];
    _sysdepsRender(_sysdepsTools);
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

function sysdepsInstall(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  const needsSudo = tool && typeof tool.installCmd === 'string' && tool.installCmd.includes('sudo ');

  if (needsSudo) {
    sudoAsk(`Installing "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // user cancelled
      _sysdepsRunInstall(id, pw);
    });
  } else {
    _sysdepsRunInstall(id, null);
  }
}

async function _sysdepsRunInstall(id, password) {
  _sysdepsInstalling = id;
  // Re-render with installing flag using cached tools list
  if (_sysdepsTools.length) _sysdepsRender(_sysdepsTools);

  const out = document.getElementById('sysdeps-out');
  if (out) { out.style.display = 'block'; out.textContent = `Installing ${id}…\n`; }

  try {
    const body = { id };
    if (password !== null && password !== undefined) body.password = password;

    const res = await fetch('/api/system/tools/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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

/* ── Update Checker ──────────────────────────────────── */

async function updateCheck() {
  const el      = document.getElementById('update-status');
  const badge   = document.getElementById('update-badge');
  const btn     = document.getElementById('update-check-btn');
  const pullBtn = document.getElementById('update-pull-btn');
  if (btn) btn.disabled = true;
  if (el) el.innerHTML = '<span class="placeholder pulse" style="font-size:12px">Checking for updates…</span>';

  try {
    const data = await apiFetch('/api/update-check?force=1');
    if (data.updateAvailable) {
      if (el) el.innerHTML = `<div class="update-info">
        <strong style="color:var(--amber)">Update available!</strong><br>
        Current: <code>${_escHtml(data.current)}</code> → Latest: <code>${_escHtml(data.latest)}</code><br>
        <a href="${_escHtml(data.repo)}/releases" target="_blank" rel="noopener">View release notes ↗</a>
      </div>`;
      if (badge) { badge.style.display = 'inline-block'; badge.title = `Update: v${data.latest} available`; }
      if (pullBtn) pullBtn.style.display = '';
    } else {
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--green)">
        ✓ Up to date — <code>${_escHtml(data.current)}</code>
      </div>`;
      if (badge) badge.style.display = 'none';
      if (pullBtn) pullBtn.style.display = 'none';
    }
  } catch (e) {
    if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">
      ✗ Could not check: ${_escHtml(e.message)}
    </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updatePull() {
  const btn = document.getElementById('update-pull-btn');
  const log = document.getElementById('update-log');
  const el  = document.getElementById('update-status');
  if (btn) btn.disabled = true;
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    const read = async () => {
      const { done, value } = await reader.read();
      if (done) return;
      decoder.decode(value).split('\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.status && log) { log.textContent += obj.status; log.scrollTop = log.scrollHeight; }
          if (obj.done) {
            if (obj.ok) {
              if (el) el.innerHTML = `<div class="update-info" style="color:var(--green)">
                ✓ Update pulled successfully. <strong>Restart the server</strong> to apply.
              </div>`;
            }
            if (btn) btn.disabled = false;
          }
        } catch {}
      });
      await read();
    };
    await read();
  } catch (e) {
    if (log) log.textContent += `\nError: ${e.message}`;
    if (btn) btn.disabled = false;
  }
}

async function restartDoca() {
  const btn = document.getElementById('restart-btn');
  if (!confirm('Restart the DOCA server? The page will reload once it comes back.')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Restarting…'; }

  try {
    await fetch('/api/restart', { method: 'POST' });
  } catch {}

  const poll = () => {
    setTimeout(async () => {
      try {
        await fetch('/api/status');
        location.reload();
      } catch {
        poll();
      }
    }, 1500);
  };
  poll();
}

/* ── Theme Picker ────────────────────────────────────── */

function _themePickerRender(prefs) {
  const grid = document.getElementById('theme-picker-grid');
  if (!grid) return;

  const active = prefs?.theme || _currentTheme || 'default';
  const customColors = prefs?.customTheme || _customThemeColors || {};

  let html = '';
  for (const [id, theme] of Object.entries(THEMES)) {
    const c = theme.colors;
    const isActive = active === id;
    html += `<div class="theme-swatch${isActive ? ' active' : ''}" onclick="_themeSelect('${id}')" title="${theme.label}">
      <div class="theme-swatch-preview">
        <div class="theme-swatch-bar" style="background:${c['--bg']}">
          <span class="theme-swatch-dot" style="background:${c['--accent']}"></span>
          <span class="theme-swatch-dot" style="background:${c['--green']}"></span>
          <span class="theme-swatch-dot" style="background:${c['--blue']}"></span>
        </div>
        <div class="theme-swatch-body" style="background:${c['--surface']}">
          <div class="theme-swatch-line" style="background:${c['--text']};opacity:.6"></div>
          <div class="theme-swatch-line short" style="background:${c['--muted']};opacity:.4"></div>
          <div class="theme-swatch-accent-bar" style="background:${c['--accent']}"></div>
        </div>
      </div>
      <div class="theme-swatch-label">${theme.label}</div>
    </div>`;
  }

  const isCustom = active === 'custom';
  html += `<div class="theme-swatch${isCustom ? ' active' : ''}" onclick="_themeSelectCustom()" title="Custom">
    <div class="theme-swatch-preview theme-swatch-custom-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="8" r="1.5" fill="var(--red)" stroke="none"/>
        <circle cx="8" cy="13" r="1.5" fill="var(--green)" stroke="none"/>
        <circle cx="16" cy="13" r="1.5" fill="var(--blue)" stroke="none"/>
        <circle cx="12" cy="17" r="1.5" fill="var(--purple)" stroke="none"/>
      </svg>
    </div>
    <div class="theme-swatch-label">Custom</div>
  </div>`;

  grid.innerHTML = html;

  if (isCustom) {
    _themeCustomEditorRender(customColors);
  }
}

async function _themeSelect(name) {
  const status = document.getElementById('theme-status');
  applyTheme(name);

  document.querySelectorAll('.theme-swatch').forEach(el => el.classList.remove('active'));
  const grid = document.getElementById('theme-picker-grid');
  if (grid) {
    const swatches = grid.querySelectorAll('.theme-swatch');
    const keys = [...Object.keys(THEMES)];
    const idx = keys.indexOf(name);
    if (idx >= 0 && swatches[idx]) swatches[idx].classList.add('active');
  }

  document.getElementById('theme-custom-editor').style.display = 'none';

  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { theme: name } });
    setStatus(status, '✓ Theme applied', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _themeSelectCustom() {
  document.querySelectorAll('.theme-swatch').forEach(el => el.classList.remove('active'));
  const grid = document.getElementById('theme-picker-grid');
  if (grid) {
    const swatches = grid.querySelectorAll('.theme-swatch');
    swatches[swatches.length - 1]?.classList.add('active');
  }

  const base = _currentTheme !== 'custom' && THEMES[_currentTheme]
    ? THEMES[_currentTheme].colors
    : THEMES.default.colors;
  const merged = { ...base, ..._customThemeColors };
  applyCustomTheme(merged);
  _themeCustomEditorRender(merged);
  _themeCustomSave(merged);
}

function _themeCustomEditorRender(colors) {
  const editor = document.getElementById('theme-custom-editor');
  if (!editor) return;
  editor.style.display = 'grid';

  const base = THEMES.default.colors;
  editor.innerHTML = THEME_CUSTOM_EDITOR_KEYS.map(({ key, label }) => {
    const val = colors[key] || base[key] || '#000000';
    return `<div class="theme-color-field">
      <label class="theme-color-label" for="tc-${key}">${label}</label>
      <div class="theme-color-input-wrap">
        <input type="color" id="tc-${key}" value="${val}" data-var="${key}" oninput="_themeCustomChange(this)">
        <span class="theme-color-hex" id="tc-hex-${key}">${val}</span>
      </div>
    </div>`;
  }).join('');
}

let _themeCustomSaveTimer = null;

function _themeCustomChange(input) {
  const varName = input.dataset.var;
  const val = input.value;
  _customThemeColors[varName] = val;
  document.documentElement.style.setProperty(varName, val);

  const hexSpan = document.getElementById(`tc-hex-${varName}`);
  if (hexSpan) hexSpan.textContent = val;

  clearTimeout(_themeCustomSaveTimer);
  _themeCustomSaveTimer = setTimeout(() => _themeCustomSave(_customThemeColors), 600);
}

async function _themeCustomSave(colors) {
  const status = document.getElementById('theme-status');
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { theme: 'custom', customTheme: colors } });
    setStatus(status, '✓ Custom theme saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
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
}

async function voiceSettingsSave() {
  const status = document.getElementById('voice-settings-status');
  const voiceServices = {
    sttUrl:   document.getElementById('voice-stt-url')?.value.trim()   || 'http://localhost:8000',
    sttModel: document.getElementById('voice-stt-model')?.value.trim() || 'whisper-1',
    ttsUrl:   document.getElementById('voice-tts-url')?.value.trim()   || 'http://localhost:8880',
    ttsModel: document.getElementById('voice-tts-model')?.value.trim() || 'kokoro',
    ttsVoice: document.getElementById('voice-tts-voice')?.value.trim() || 'af_heart',
  };
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { voiceServices } });
    setStatus(status, '✓ Saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
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

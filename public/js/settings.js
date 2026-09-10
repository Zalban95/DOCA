/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SETTINGS TAB
   ═══════════════════════════════════════════════════════ */

const SETTINGS_TABS = [
  { id: 'controls',  label: 'Controls' },
  { id: 'logs',      label: 'Logs' },
  { id: 'files',     label: 'Files' },
  { id: 'harness',   label: 'Harness' },
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
  { id: 'system',    label: 'System',    init: '_subtabSystemInit' },
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
    const active = _SETTINGS_SUBTABS[i]?.id === panelId;
    btn.classList.toggle('active', active);
    // Keep the active pill visible when the sub-nav scrolls horizontally (mobile)
    if (active && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  document.querySelectorAll('#tab-settings .settings-panel').forEach(p => {
    p.classList.toggle('active', p.id === `sp-${panelId}`);
  });

  const entry = _SETTINGS_SUBTABS.find(t => t.id === panelId);
  if (entry && !_subtabInited[panelId]) {
    _subtabInited[panelId] = true;
    const fn = window[entry.init];
    if (typeof fn === 'function') fn();
  }
}

async function _subtabGeneralInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _settingsRender();
    _themePickerRender(prefs);
    _statsSettingsRender(prefs);
  } catch (e) {
    const el = document.getElementById('settings-tabs-list');
    if (el) el.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
  updateCheck();
  startupLoad();
}

function _subtabSystemInit() {
  pathsLoad();
  sysdepsLoad();
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
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}
               onchange="settingsSave()">
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">${t.label}</span>
    </div>
  `).join('');
}

/** Saves on every toggle, like the sidebar stats next to it — a checkbox that
 *  silently does nothing until you find a Save button is a trap. */
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
  document.querySelectorAll('.nav-tab[data-tab], .mobile-nav-item[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'settings') return;
    btn.style.display = hiddenTabs.includes(tab) ? 'none' : '';
  });
}

/* Called on app startup to apply persisted hidden tabs + sidebar sections */
async function settingsApplyOnLoad() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _applyHiddenTabs(_settingsHidden);
    _sidebarSections = prefs.sidebarSections || {};
    applySidebarSections(_sidebarSections);
  } catch {}
  _silentUpdateBadgeCheck();
}

/* ── Sidebar sections + system stats toggles ─────────── */

const SIDEBAR_SECTIONS = [
  { id: 'containers', label: 'Containers' },
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

    const toggleRow = (idAttr, checked, label, onchange) => `
      <div class="settings-tab-row">
        <label class="skill-toggle">
          <input type="checkbox" id="${idAttr}" ${checked ? 'checked' : ''} onchange="${onchange}">
          <span class="skill-toggle-track"></span>
        </label>
        <span class="settings-tab-label">${label}</span>
      </div>`;

    let html = '<div class="tool-group-label">System stats</div>';
    html += _statsDefs.filter(d => d.group === 'system').map(d =>
      toggleRow(`stat-toggle-${d.id}`, enabled[d.id], escHtml(d.label),
        `statsToggleChange('${d.id}', this.checked)`)).join('');

    html += '<div class="tool-group-label" style="margin-top:12px">GPU stats</div>';
    html += _statsDefs.filter(d => d.group === 'gpu').map(d =>
      toggleRow(`stat-toggle-${d.id}`, enabled[d.id], escHtml(d.label),
        `statsToggleChange('${d.id}', this.checked)`)).join('');

    html += '<div class="tool-group-label" style="margin-top:12px">Sidebar sections</div>';
    html += SIDEBAR_SECTIONS.map(s =>
      toggleRow(`section-toggle-${s.id}`, sections[s.id] !== false, escHtml(s.label),
        `sectionToggleChange('${s.id}', this.checked)`)).join('');

    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
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
    await apiFetch('/api/prefs', { method: 'POST', body: { sidebarSections: _sidebarSections } });
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

    html += `<div class="tool-group-label" style="color:${SYSDEP_CATEGORY_COLOR[cat]}">${SYSDEP_CATEGORY_LABEL[cat]}</div>`;
    html += group.map(t => toolRowHtml({
      id:             `sysdep-${t.id}`,
      label:          t.label,
      note:           t.note,
      detected:       t.detected,
      version:        t.version,
      canInstall:     t.canInstall,
      installing:     _sysdepsInstalling === t.id,
      installOnclick: `sysdepsInstall('${t.id}')`,
      updateOnclick:  t.canInstall ? `sysdepsUpdate('${t.id}')` : '',
      repo:           t.repo,
      repoLabel:      t.repoLabel,
    })).join('');
  });

  list.innerHTML = html;
}

function sysdepsInstall(id) { _sysdepsStart(id, 'Installing'); }

/** Updating is re-running the installer: apt reinstalls the current release,
 *  vendor scripts fetch the latest, git-backed stacks pull. Confirmed first —
 *  on a tool that already works this can swap a live binary or restart
 *  services, which is not what "↻" suggests on its own. */
function sysdepsUpdate(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  appConfirm(
    `Update "${tool ? tool.label : id}" by re-running its installer? ` +
    `If it is already up to date this changes nothing; otherwise it upgrades in place.`,
    () => _sysdepsStart(id, 'Updating'),
  );
}

function _sysdepsStart(id, verb) {
  const tool = _sysdepsTools.find(t => t.id === id);
  const needsSudo = tool && (tool.needsSudo || (typeof tool.installCmd === 'string' && tool.installCmd.includes('sudo ')));

  if (needsSudo) {
    sudoAsk(`${verb} "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // user cancelled
      _sysdepsRunInstall(id, pw, verb);
    });
  } else {
    _sysdepsRunInstall(id, null, verb);
  }
}

async function _sysdepsRunInstall(id, password, verb = 'Installing') {
  _sysdepsInstalling = id;
  // Re-render with installing flag using cached tools list
  if (_sysdepsTools.length) _sysdepsRender(_sysdepsTools);

  const out = document.getElementById('sysdeps-out');
  showStream(out, `${verb} ${id}…\n`);

  const body = { id };
  if (password !== null && password !== undefined) body.password = password;

  await sseStream('/api/system/tools/install', body, {
    onStatus: text => appendStream(out, text),
    onDone: () => {
      _sysdepsInstalling = null;
      setTimeout(sysdepsLoad, 800);
    },
    onError: e => {
      if (out) out.textContent += `\nError: ${e.message}`;
      _sysdepsInstalling = null;
      setTimeout(sysdepsLoad, 500);
    },
  });
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
        Current: <code>${escHtml(data.current)}</code> → Latest: <code>${escHtml(data.latest)}</code><br>
        <a href="${escHtml(data.repo)}/releases" target="_blank" rel="noopener">View release notes ↗</a>
      </div>`;
      if (badge) { badge.style.display = 'inline-block'; badge.title = `Update: v${data.latest} available`; }
      if (pullBtn) pullBtn.style.display = '';
    } else {
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--green)">
        ✓ Up to date — <code>${escHtml(data.current)}</code>
      </div>`;
      if (badge) badge.style.display = 'none';
      if (pullBtn) pullBtn.style.display = 'none';
    }
  } catch (e) {
    if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">
      ✗ Could not check: ${escHtml(e.message)}
    </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updatePull() {
  const btn  = document.getElementById('update-pull-btn');
  const log  = document.getElementById('update-log');
  const el   = document.getElementById('update-status');
  // An update can run `npm install`; restarting through that leaves a
  // half-installed tree, so hold the button until the stream is done.
  const rbtn = document.getElementById('restart-btn');
  const rTitle = rbtn?.title;
  if (btn) btn.disabled = true;
  if (rbtn) { rbtn.disabled = true; rbtn.title = 'Wait for the update to finish before restarting'; }
  if (log) { log.style.display = 'block'; log.textContent = ''; }

  const releaseRestart = () => {
    if (rbtn) { rbtn.disabled = false; if (rTitle) rbtn.title = rTitle; }
  };

  await sseStream('/api/update', {}, {
    onStatus: text => appendStream(log, text),
    onDone: obj => {
      if (obj.ok && el) {
        el.innerHTML = `<div class="update-info" style="color:var(--green)">
          ✓ Update pulled successfully. <strong>Restart the server</strong> to apply.
        </div>`;
      }
      if (btn) btn.disabled = false;
      releaseRestart();
    },
    onError: e => {
      if (log) log.textContent += `\nError: ${e.message}`;
      if (btn) btn.disabled = false;
      releaseRestart();
    },
  });
}

/* ── Start at Boot ───────────────────────────────────── */

async function startupLoad() {
  const box = document.getElementById('startup-toggle');
  const st  = document.getElementById('startup-status');
  try {
    const s = await apiFetch('/api/startup');
    if (box) { box.checked = !!s.enabled; box.disabled = !s.supported; }
    if (!s.supported) return setStatus(st, s.reason, 'warn');

    if (!s.enabled) return setStatus(st, 'DOCA will not come back on its own after a reboot.', '');
    setStatus(st, s.active
      ? `✓ Enabled — ${s.service} is running${s.supervised ? ' and owns this panel' : ''}`
      : `✓ Enabled — ${s.service} starts at the next boot`, 'ok');
  } catch (e) {
    if (box) box.disabled = true;
    setStatus(st, `✗ ${e.message}`, 'err');
  }
}

function startupToggle(box) {
  const want = box.checked;
  box.checked = !want;   // stay on the real state until the service confirms it
  sudoAsk(
    `${want ? 'Installing' : 'Removing'} the boot service requires elevated privileges.`,
    pw => { if (pw !== null) _startupApply(want, pw); },
  );
}

async function _startupApply(enabled, password) {
  const box = document.getElementById('startup-toggle');
  const log = document.getElementById('startup-log');
  if (box) box.disabled = true;
  showStream(log);

  const finish = () => { if (box) box.disabled = false; startupLoad(); };
  await sseStream('/api/startup', { enabled, password }, {
    onStatus: text => appendStream(log, text),
    onDone:   finish,
    onError:  e => { appendStream(log, `\nError: ${e.message}`); finish(); },
  });
}

const RESTART_TIMEOUT_MS = 90000;

function restartDoca() {
  appConfirm('Restart the DOCA server? The page will reload once it comes back.', async () => {
    const btn = document.getElementById('restart-btn');
    const el  = document.getElementById('update-status');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Restarting…'; }

    // The process exits ~500ms after replying, so a dropped response is normal.
    let info = {};
    try {
      const r = await fetch('/api/restart', { method: 'POST' });
      info = await r.json().catch(() => ({}));
    } catch {}

    if (info.ok === false) {
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">✗ ${escHtml(info.error || 'Restart failed.')}</div>`;
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Restart'; }
      return;
    }

    const started = Date.now();

    // Never spin forever: if nothing is listening again, say where to look.
    const giveUp = () => {
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Restart'; }
      if (!el) return;
      const where = info.selfRespawn
        ? `A successor process was started${info.handoff?.pid ? ` (pid ${info.handoff.pid})` : ''} but never began serving — check <code>${escHtml(info.handoff?.log || '.doca/restart.log')}</code> on the host.`
        : `DOCA is supervised by <code>${escHtml(info.supervisor || 'an external supervisor')}</code>, so check it there — e.g. <code>systemctl status openclaw-panel</code>.`;
      el.innerHTML = `<div class="update-info" style="color:var(--red)">
        ✗ The server did not come back within ${Math.round(RESTART_TIMEOUT_MS / 1000)}s.<br>${where}
      </div>`;
    };

    const poll = () => {
      setTimeout(async () => {
        try {
          const r = await fetch('/api/status', { cache: 'no-store' });
          if (!r.ok) throw new Error(String(r.status));
          location.reload();
          return;
        } catch {}
        if (Date.now() - started >= RESTART_TIMEOUT_MS) return giveUp();
        if (btn) btn.textContent = `⟳ Restarting… ${Math.round((Date.now() - started) / 1000)}s`;
        poll();
      }, 1500);
    };
    poll();
  });
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
  const speed = vs.ttsSpeed ?? 1.0;
  set('voice-tts-speed', speed, '1.0');
  const lbl = document.getElementById('voice-tts-speed-val');
  if (lbl) lbl.textContent = speed;
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


/* ═══════════════════════════════════════════════════════
   Settings → General → Appearance: the style (look.js) and the colour theme.
   ═══════════════════════════════════════════════════════ */

/* ── Style ───────────────────────────────────────────── */

/** Two tiles above the colour themes, built like them (.theme-swatch). */
function _lookPickerRender(prefs) {
  const grid = document.getElementById('theme-picker-grid');
  if (!grid) return;
  let row = document.getElementById('look-picker');
  if (!row) {
    row = document.createElement('div');
    row.id = 'look-picker';
    row.className = 'look-picker';
    grid.before(row);
    const label = document.createElement('div');
    label.className = 'input-label';
    label.textContent = 'Colours';
    grid.before(label);
  }
  const active = document.documentElement.dataset.skin || prefs?.skin || 'classic';
  row.innerHTML = `<div class="input-label">Style</div><div class="look-tiles">${Object.entries(SKINS).map(([id, s]) => `
    <button type="button" class="theme-swatch look-tile look-tile-${id}${id === active ? ' active' : ''}" onclick="_lookSelect('${id}')">
      <span class="look-tile-sample">Aa</span>
      <span class="look-tile-text"><span class="theme-swatch-label">${s.label}</span><span class="look-tile-note">${s.note}</span></span>
    </button>`).join('')}</div>`;
}

async function _lookSelect(id) {
  const skin = lookApply(id);
  _lookPickerRender({ skin });
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { skin } });
    setStatus(document.getElementById('theme-status'), `✓ ${SKINS[skin].label} style`, 'ok');
  } catch (e) {
    setStatus(document.getElementById('theme-status'), `✗ ${e.message}`, 'err');
  }
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

  document.querySelectorAll('#theme-picker-grid .theme-swatch').forEach(el => el.classList.remove('active'));
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
  document.querySelectorAll('#theme-picker-grid .theme-swatch').forEach(el => el.classList.remove('active'));
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


/* ═══════════════════════════════════════════════════════
   Settings → General → Appearance: the look (look.js — the shape of things), then colours for it.

   One choice, then its colours (self-test 2026-10-08: two lists, STYLE and COLOURS, both had "Points", so "a theme"
   was not one choice). The colours that belong with the look in use come first, named within it ("Dark",
   "Daylight" under Points); every other palette stays one fold away under "More colours", Custom with them. The
   saved keys are as before: `skin` for the look, `theme` for the colours.
   ═══════════════════════════════════════════════════════ */

/** The palettes made for each look, its own first; any palette works with any look. */
const LOOK_PALETTES = {
  classic: ['default', 'dracula', 'nord', 'solarized', 'monokai', 'catppuccin', 'gruvbox', 'tokyoNight', 'oneDark', 'cyberpunk'],
  modern: ['daylight', 'default'],
  points: ['points', 'pointsDaylight'],
};

/** A palette's name under its own look: the look's name left off ("Points Daylight" → "Daylight", "Points" → "Dark"). */
function _lookPaletteLabel(id, skin) {
  const label = THEMES[id]?.label || id, look = SKINS[skin]?.label || '';
  if (!LOOK_PALETTES[skin]?.includes(id) || !look || !label.startsWith(look)) return label;
  return label.slice(look.length).trim() || 'Dark';
}

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
    label.id = 'look-colours-label';
    grid.before(label);
  }
  const active = document.documentElement.dataset.skin || prefs?.skin || 'classic';
  document.getElementById('look-colours-label').textContent = `Colours for ${SKINS[active]?.label || 'this look'}`;
  row.innerHTML = `<div class="input-label">Look</div><div class="look-tiles">${Object.entries(SKINS).map(([id, s]) => `
    <button type="button" class="theme-swatch look-tile look-tile-${id}${id === active ? ' active' : ''}" onclick="_lookSelect('${id}')">
      <span class="look-tile-sample">Aa</span>
      <span class="look-tile-text"><span class="theme-swatch-label">${s.label}</span><span class="look-tile-note">${s.note}</span></span>
    </button>`).join('')}</div>`;
}

/* The colours chosen for a look are its own: Classic + Nord, then Modern, then Classic again brought back Nord's
   neighbour, not Nord (self-test round two, C9). Each look remembers its last palette (screen setting `lookThemes`). */
async function _lookThemes() {
  try { return { ...((await screenLoad())?.settings?.lookThemes || {}) }; } catch { return {}; }
}

async function _lookSelect(id) {
  const was = document.documentElement.dataset.skin || 'classic', themes = await _lookThemes();
  themes[was] ||= _currentTheme;   // the look being left keeps what it showed, even if never chosen here
  const skin = lookApply(id);
  const kept = themes[skin] === 'custom' || THEMES[themes[skin]] ? themes[skin] : null;
  const palette = kept || (typeof lookPointsPalette === 'function' ? lookPointsPalette(skin) : null);   // Points brings its palette
  if (palette === 'custom') applyCustomTheme({ ...THEMES.default.colors, ..._customThemeColors }); else if (palette) applyTheme(palette);
  _lookPickerRender({ skin });
  _themePickerRender({ theme: palette || _currentTheme });   // its own colours first
  try {
    await screenSave({ skin, lookThemes: themes, ...(palette ? { theme: palette } : {}) });
    setStatus(document.getElementById('theme-status'), `✓ ${SKINS[skin].label} look`, 'ok');
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

  const skin = document.documentElement.dataset.skin || 'classic';
  const own = (LOOK_PALETTES[skin] || []).filter(id => THEMES[id]);
  const swatch = id => {
    const theme = THEMES[id], c = theme.colors, isActive = active === id;
    return `<div class="theme-swatch${isActive ? ' active' : ''}" data-theme="${id}" onclick="_themeSelect('${id}')" title="${theme.label}">
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
      <div class="theme-swatch-label">${escHtml(_lookPaletteLabel(id, skin))}</div>
    </div>`;
  };

  const isCustom = active === 'custom';
  const others = Object.keys(THEMES).filter(id => !own.includes(id));
  const custom = `<div class="theme-swatch${isCustom ? ' active' : ''}" data-theme="custom" onclick="_themeSelectCustom()" title="Custom">
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

  // Open when the colours in use are among the others, so the chosen one is never hidden.
  grid.innerHTML = own.map(swatch).join('') + `<details class="theme-more"${!own.includes(active) ? ' open' : ''}>
    <summary>More colours <span>— made for another look, or your own; any of them works with this one</span></summary>
    <div class="theme-grid">${others.map(swatch).join('')}${custom}</div></details>`;

  if (isCustom) {
    _themeCustomEditorRender(customColors);
  }
}

async function _themeSelect(name) {
  const status = document.getElementById('theme-status');
  applyTheme(name);

  document.querySelectorAll('#theme-picker-grid .theme-swatch').forEach(el => el.classList.toggle('active', el.dataset.theme === name));

  document.getElementById('theme-custom-editor').style.display = 'none';

  try {
    const skin = document.documentElement.dataset.skin || 'classic';
    await screenSave({ theme: name, lookThemes: { ...(await _lookThemes()), [skin]: name } });
    setStatus(status, '✓ Theme applied', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _themeSelectCustom() {
  document.querySelectorAll('#theme-picker-grid .theme-swatch').forEach(el => el.classList.toggle('active', el.dataset.theme === 'custom'));

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
    await screenSave({ theme: 'custom', customTheme: colors, lookThemes: { ...(await _lookThemes()), [document.documentElement.dataset.skin || 'classic']: 'custom' } });
    setStatus(status, '✓ Custom theme saved', 'ok');
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}


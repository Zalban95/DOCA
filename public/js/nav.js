/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — NAVIGATION
   ═══════════════════════════════════════════════════════ */

const NAV_TABS = ['controls','logs','files','code','terminal','models','docker','settings'];

/** Single source for the mobile bottom bar (icon + short label per tab). */
const NAV_TAB_DEFS = [
  { id: 'controls', label: 'Ctrl',   icon: '▶' },
  { id: 'logs',     label: 'Logs',   icon: '≣' },
  { id: 'files',    label: 'Files',  icon: '🗀' },
  { id: 'code',     label: 'Code',   icon: '❯' },
  { id: 'terminal', label: 'Term',   icon: '⌨' },
  { id: 'models',   label: 'Models', icon: '◆' },
  { id: 'docker',   label: 'Docker', icon: '◧' },
  { id: 'settings', label: 'Set',    icon: '⚙' },
];

/** Render the mobile bottom tab bar (visible ≤768px via CSS). */
function mobileNavRender() {
  const bar = document.getElementById('mobile-nav');
  if (!bar) return;
  bar.innerHTML = NAV_TAB_DEFS.map(t => `
    <button class="mobile-nav-item ${currentTab === t.id ? 'active' : ''}" data-tab="${t.id}"
            onclick="nav('${t.id}')" aria-label="${t.label}">
      <span class="mobile-nav-icon">${t.icon}</span>
      <span class="mobile-nav-label">${t.label}</span>
    </button>
  `).join('');
}

function nav(name) {
  currentTab = name;

  document.querySelectorAll('.nav-tab, .mobile-nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });

  document.querySelectorAll('.tab-page').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${name}`);
  });

  if (name === 'controls') controlsInit();
  if (name === 'logs'      && !logSource) startLogs();
  if (name === 'files')    fmInit();
  if (name === 'code')     codeInit();
  if (name === 'terminal') termInit();
  if (name === 'models')   modelsInit();
  if (name === 'docker')   dockerInit();
  if (name === 'settings') settingsInit();

  closeSidebar();
}

/* ── Mobile sidebar ──────────────────────────────────── */
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.querySelector('.sidebar').classList.toggle('open', sidebarOpen);
  document.getElementById('sidebar-backdrop').classList.toggle('visible', sidebarOpen);
}

function closeSidebar() {
  sidebarOpen = false;
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('visible');
}

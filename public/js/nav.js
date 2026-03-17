/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — NAVIGATION
   ═══════════════════════════════════════════════════════ */

const NAV_TABS = ['controls','logs','files','code','terminal','models','docker','settings'];

function nav(name) {
  currentTab = name;

  document.querySelectorAll('.nav-tab').forEach(t => {
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

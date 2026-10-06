/* ═══════════════════════════════════════════════════════
   DOCA PANEL — NAVIGATION
   ═══════════════════════════════════════════════════════ */

const NAV_TABS = ['controls','logs','files','projects','harness','computers','terminal','models','docker','vms','mcp','settings'];
/** Tabs that are the machine itself: left out for a person without host (settings.js). */
const HOST_TABS = ['logs', 'files', 'projects', 'terminal', 'computers'];

/** The header and the phone's bar are drawn by group (nav-groups.js). */
function mobileNavRender() { navGroupsRender(); }

function nav(name) {
  currentTab = name;

  navGroupsMark(name);   // its group opens, and remembers it (nav-groups.js)

  document.querySelectorAll('.tab-page').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${name}`);
  });

  // The Harness tab is a full-size conversation with the same agent the
  // floating panel talks to, so the panel steps aside while it is open.
  document.body.classList.toggle('harness-tab', name === 'harness');
  if (name === 'harness' && chatOpen) toggleChat();

  if (name === 'controls') controlsInit();
  if (name === 'logs'      && !logSource) startLogs();
  if (name === 'files')    fmInit();
  if (name === 'projects') projectsInit();
  if (name === 'harness')  harnessTabInit();
  computersTab(name === 'computers');   // starts and stops its thumbnails' timer
  if (name === 'terminal') termInit();
  if (name === 'models')   modelsInit();
  if (name === 'docker')   dockerInit();
  if (name === 'vms')      vmsInit();
  if (name === 'mcp')      mcpInit();
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

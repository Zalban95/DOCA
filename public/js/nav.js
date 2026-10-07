/* ═══════════════════════════════════════════════════════
   DOCA PANEL — NAVIGATION
   ═══════════════════════════════════════════════════════ */

const NAV_TABS = ['controls','ambient','logs','files','projects','harness','workstream','archive','chronicle','computers','live','terminal','models','docker','vms','mcp','connectors','apikeys','settings'];
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
  if (name === 'archive')  archiveInit();
  computersTab(name === 'computers');
  if (typeof workstreamTab === 'function') workstreamTab(name === 'workstream');
  if (typeof chronicleTab === 'function') chronicleTab(name === 'chronicle');   // hears turns and missions only while shown
  if (typeof ambientTab === 'function') ambientTab(name === 'ambient');
  if (name === 'models' && typeof wakewordTab === 'function') wakewordTab();
  if (name === 'models' && typeof modelsRolesCard === 'function') modelsRolesCard();
  if (typeof liveMachinesTab === 'function') liveMachinesTab(name === 'live');   // refreshes only while shown   // holds the hub's sentinel while shown   // starts and stops its thumbnails' timer
  if (name === 'terminal') termInit();
  if (name === 'models')   modelsInit();
  if (name === 'docker')   dockerInit();
  if (name === 'vms')      vmsInit();
  if (name === 'mcp')      mcpInit();
  if (typeof FIELD_PAGES !== 'undefined' && FIELD_PAGES[name]) fieldPageShow(name);   // Connectors, API keys (field-pages.js)
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

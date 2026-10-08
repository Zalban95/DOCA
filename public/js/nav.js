/* ═══════════════════════════════════════════════════════
   DOCA PANEL — NAVIGATION
   ═══════════════════════════════════════════════════════ */

const NAV_TABS = ['controls','home','ambient','logs','files','projects','harness','workstream','archive','chronicle','computers','live','terminal','models','docker','vms','vnc','mcp','connectors','apikeys','settings'];
/** Tabs that are the machine itself: left out for a person without host (settings.js). */
const HOST_TABS = ['logs', 'files', 'projects', 'terminal', 'computers', 'vnc'];

/** The header and the phone's bar are drawn by group (nav-groups.js). */
function mobileNavRender() { navGroupsRender(); }

/** Whether a page is on screen: the open page, or one part of the person's own page that is open (panel-layout.js). */
const pageShown = t => currentTab === t || (typeof panelViewParts === 'function' && panelViewParts(currentTab).includes(t));

function nav(name) {
  currentTab = name;

  navGroupsMark(name);   // its group opens, and remembers it (nav-groups.js)

  // A page of the person's own (panel-layout.js) shows several of the panel's pages at once: each is started as if
  // it were open, then placed in the view. Any other page is just itself.
  const shown = typeof panelViewParts === 'function' ? panelViewParts(name) : [name];
  const on = t => shown.includes(t);
  const activate = () => document.querySelectorAll('.tab-page').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${name}` || on(el.id.slice(4)));
  });
  activate();

  // The Harness tab is a full-size conversation with the same agent the
  // floating panel talks to, so the panel steps aside while it is open.
  document.body.classList.toggle('harness-tab', name === 'harness');
  if (name === 'harness' && chatOpen) toggleChat();

  if (on('controls')) controlsInit();
  if (on('logs')      && !logSource) startLogs();
  if (on('files'))    fmInit();
  if (on('projects')) projectsInit();
  if (on('harness'))  harnessTabInit();
  if (on('archive'))  archiveInit();
  computersTab(on('computers'));
  if (typeof workstreamTab === 'function') workstreamTab(on('workstream'));   // holds the hub's sentinel while shown
  if (typeof chronicleTab === 'function') chronicleTab(on('chronicle'));   // hears turns and missions only while shown
  if (typeof homeTab === 'function') homeTab(on('home'));   // holds the hub's connection to Home Assistant while shown
  if (typeof ambientTab === 'function') ambientTab(on('ambient'));
  if (on('models') && typeof wakewordTab === 'function') wakewordTab();
  if (on('models') && typeof modelsRolesCard === 'function') modelsRolesCard();
  if (typeof liveMachinesTab === 'function') liveMachinesTab(on('live'));   // refreshes only while shown; starts and stops its thumbnails' timer
  if (on('terminal')) termInit();
  if (on('models'))   modelsInit();
  if (on('docker'))   dockerInit();
  if (on('vms'))      vmsInit();
  if (typeof vncTab === 'function') vncTab(on('vnc'));   // Machines → VNC: refreshes its states only while shown
  if (on('mcp'))      mcpInit();
  for (const t of shown) if (typeof FIELD_PAGES !== 'undefined' && FIELD_PAGES[t]) fieldPageShow(t);   // Connectors, API keys (field-pages.js)
  if (name === 'settings') settingsInit();

  if (typeof panelViewPlace === 'function') { panelViewPlace(name); activate(); }   // pages made by their init land in the view
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

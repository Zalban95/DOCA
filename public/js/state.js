/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — GLOBAL STATE
   ═══════════════════════════════════════════════════════ */

var autoScroll  = true;
var logSource   = null;
var currentTab  = 'controls';
var sidebarOpen = false;
var chatOpen    = false;
var coresOpen   = false;   // sidebar "Logical cores" dropdown open/closed state
var procsOpen   = false;   // sidebar "Top processes" dropdown open/closed state

// Merged stats enabled-map (from /api/status statsEnabled); null until first poll
var _statsEnabled = null;
// Sidebar section visibility map (prefs.sidebarSections); {} = all visible
var _sidebarSections = {};

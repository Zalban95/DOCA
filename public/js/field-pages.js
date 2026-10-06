/* Field (asked 2026-10-06: "MCP, connectors and API should be in the same tab, even models is there, and we can call
   the tab Field"): what the agents reach out with — models, MCP servers, connectors (accounts, keys for services,
   logins, what the agent prepared) and API keys (providers, devices, DOCA's apps) — as one group of pages. Connectors
   and API keys were Settings sections: their panels move into these pages the first time they are opened and keep
   working exactly as before; an old link to the Settings section lands here (settings/subnav.js). */
const FIELD_PAGES = { connectors: 'connectors', apikeys: 'keys' };   // page → the Settings panel it shows

function fieldPageShow(page) {
  const id = FIELD_PAGES[page];
  const host = document.getElementById(`tab-${page}`), panel = document.getElementById(`sp-${id}`);
  if (!host || !panel) return;
  if (panel.parentElement !== host) host.append(panel);
  panel.classList.add('active');
  const entry = typeof _SETTINGS_SUBTABS !== 'undefined' && _SETTINGS_SUBTABS.find(t => t.id === id);
  if (entry?.init && !_subtabInited[id]) { _subtabInited[id] = true; window[entry.init]?.(); }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  for (const page of Object.keys(FIELD_PAGES)) {
    const el = Object.assign(document.createElement('div'), { className: 'tab-page field-page', id: `tab-${page}` });
    document.getElementById('tab-settings')?.before(el);
  }
});

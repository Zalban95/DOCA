'use strict';

/**
 * The panel's pages and Settings sections, read from the front end's own lists (public/js/nav.js, nav-groups.js,
 * settings/subnav.js) — so a feature's "where" is said the way the panel says it ("Field → Models", "Settings →
 * System") and the names cannot drift from what a person sees. Those files are classic scripts that only declare
 * at the top level, so evaluating them in a sandbox with a stub localStorage runs nothing of the panel.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let _lists = null;
function lists() {
  if (_lists) return _lists;
  const js = f => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', f), 'utf8');
  const ctx = { localStorage: { getItem: () => null, setItem() {} } };
  try {
    vm.runInNewContext(`${js('nav.js')}\n${js('nav-groups.js')}\n${js('settings/subnav.js')}\n`
      + 'this.out = { NAV_TABS, NAV_GROUPS, NAV_LABELS, SUB: _SETTINGS_SUBTABS.map(t => ({ id: t.id, label: t.label, page: t.page || null })) };', ctx);
    _lists = JSON.parse(JSON.stringify(ctx.out));
  } catch { _lists = { NAV_TABS: [], NAV_GROUPS: [], NAV_LABELS: {}, SUB: [] }; }   // labels fall back to ids
  return _lists;
}

/** "harness" → "Agents → Harness"; "settings/system" → "Settings → System". */
function label(page) {
  const l = lists();
  const [top, sub] = String(page).split('/');
  if (top === 'settings' && sub) return `Settings → ${l.SUB.find(t => t.id === sub)?.label || sub}`;
  const g = l.NAV_GROUPS.find(x => x.tabs.includes(top));
  const name = l.NAV_LABELS[top] || top;
  return g && g.tabs.length > 1 ? `${g.label} → ${name}` : name;
}

module.exports = { lists, label };

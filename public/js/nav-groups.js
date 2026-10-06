/* The pages in groups, by what they are for (asked 2026-10-06: "API, models, docker, VMs, PCs need to be moved in groups
   … depending on the type, utility"). The header shows one pill per group; the group in use opens to its pages, and
   a group remembers the page last used in it, so going back to it is one click. On a phone the bottom bar is the
   groups, and a group with more than one page offers them in a small menu. Every page keeps its id and `nav()`: only
   how they are drawn changed, so links, search and hidden tabs work as before (hidden pages leave their group, and a
   group with none left is not drawn). */
const NAV_GROUPS = [
  { id: 'controls', label: 'Controls', icon: '▶', tabs: ['controls', 'ambient'] },
  { id: 'agents', label: 'Agents', icon: '⬡', tabs: ['harness', 'workstream', 'projects', 'archive'] },
  { id: 'machines', label: 'Machines', icon: '🖵', tabs: ['live', 'computers', 'vms', 'docker'] },
  { id: 'host', label: 'Hub', icon: '⌨', tabs: ['files', 'terminal', 'logs'] },
  { id: 'intelligence', label: 'Field', icon: '◆', tabs: ['models', 'mcp', 'connectors', 'apikeys'] },
  { id: 'settings', label: 'Settings', icon: '⚙', tabs: ['settings'] },
];
const NAV_LABELS = { controls: 'Controls', ambient: 'Ambient', harness: 'Harness', workstream: 'Workstream', projects: 'Projects', archive: 'Archive', computers: 'Computers', live: 'Live', vms: 'VMs', docker: 'Docker',
  files: 'Files', terminal: 'Terminal', logs: 'Logs', models: 'Models', mcp: 'MCP', connectors: 'Connectors', apikeys: 'API keys', settings: 'Settings' };

const navGroupOf = tab => NAV_GROUPS.find(g => g.tabs.includes(tab)) || NAV_GROUPS[0];
let _navLast = (() => { try { return JSON.parse(localStorage.getItem('doca.nav.last') || '{}'); } catch { return {}; } })();

/** A page is shown unless hidden (Settings → General, or a person without host): its header button says. */
const _navShown = tab => document.querySelector(`.nav-tabs .nav-tab[data-tab="${tab}"]`)?.style.display !== 'none';
const _navShownIn = g => g.tabs.filter(_navShown);

/** The header's groups and the phone's bar. */
function navGroupsRender() {
  const top = document.querySelector('header .nav-tabs');
  const tabBtn = t => `<button class="nav-tab" data-tab="${t}" onclick="nav('${t}')">${NAV_LABELS[t]}</button>`;
  if (top) top.innerHTML = NAV_GROUPS.map(g => (g.tabs.length === 1 ? tabBtn(g.tabs[0])
    : `<span class="nav-group" data-group="${g.id}"><button class="nav-tab nav-group-btn" data-group="${g.id}" onclick="navGroup('${g.id}')"
        title="${g.tabs.map(t => NAV_LABELS[t]).join(', ')}">${g.label}</button>${g.tabs.map(tabBtn).join('')}</span>`)).join('');
  const bar = document.getElementById('mobile-nav');
  if (bar) bar.innerHTML = NAV_GROUPS.map(g => `<button class="mobile-nav-item" data-group="${g.id}" onclick="navGroupTap('${g.id}', this)" aria-label="${g.label}">
      <span class="mobile-nav-icon">${g.icon}</span><span class="mobile-nav-label">${g.short || g.label}</span></button>`).join('');
  navGroupsMark(currentTab);
}

/** After `nav(tab)`: its group opens, the others fold, and the group remembers it. */
function navGroupsMark(tab) {
  const g = navGroupOf(tab);
  _navLast[g.id] = tab;
  try { localStorage.setItem('doca.nav.last', JSON.stringify(_navLast)); } catch { /* storage blocked: it forgets */ }
  document.querySelectorAll('.nav-group').forEach(el => el.classList.toggle('open', el.dataset.group === g.id));
  document.querySelectorAll('.nav-tab[data-tab], .mobile-nav-item[data-group]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab ? el.dataset.tab === tab : el.dataset.group === g.id));
  document.getElementById('nav-group-menu')?.remove();
  if (typeof presenceNow === 'function') presenceNow();   // what this screen shows (Devices)
}

/** A group: the page last used in it, else its first shown one. */
function navGroup(id) {
  const g = NAV_GROUPS.find(x => x.id === id), shown = g ? _navShownIn(g) : [];
  if (shown.length) nav(shown.includes(_navLast[id]) ? _navLast[id] : shown[0]);
}

/** On a phone: a group of one page opens it; a group of more offers its pages above the bar. */
function navGroupTap(id, btn) {
  const g = NAV_GROUPS.find(x => x.id === id), shown = g ? _navShownIn(g) : [];
  const open = document.getElementById('nav-group-menu');
  if (open) { const same = open.dataset.group === id; open.remove(); if (same) return; }
  if (shown.length <= 1) return navGroup(id);
  const menu = Object.assign(document.createElement('div'), { id: 'nav-group-menu', className: 'nav-group-menu' });
  menu.dataset.group = id;
  menu.innerHTML = shown.map(t => `<button class="${t === currentTab ? 'active' : ''}" onclick="nav('${t}')">${NAV_LABELS[t]}</button>`).join('');
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2))}px`;
}

/** Hidden pages leave their group; a group with none left is not drawn. Called after the hidden tabs are applied. */
function navGroupsVisibility() {
  for (const g of NAV_GROUPS) {
    const none = !_navShownIn(g).length;
    document.querySelectorAll(`[data-group="${g.id}"]`).forEach(el => { if (el.matches('.nav-group, .mobile-nav-item')) el.style.display = none ? 'none' : ''; });
  }
}

/* ═══════════════════════════════════════════════════════
   Flow: the groups on a side rail (docs/design/flow-experience.md). The rail draws the person's own groups —
   NAV_GROUPS as their layout made them (panel-layout.js), so a person's own regrouping is what it shows — each a
   point, its name and how many pages it holds, Settings at the foot; the open group's pages stay the tabs under the
   header (nav-groups.js), underlined in the accent. On a phone the same pages are chips over the bottom bar, and a
   group in the bar opens straight away (no menu). Only a presentation: every page keeps its id and nav().
   ═══════════════════════════════════════════════════════ */

function flowRailDraw(tab = typeof currentTab !== 'undefined' ? currentTab : null) {
  let rail = document.getElementById('flow-rail');
  const want = _flow.mode === 'flow' && _flow.groups === 'rail' && typeof NAV_GROUPS !== 'undefined';
  if (!want) { rail?.remove(); return; }
  const body = document.querySelector('.app-body');
  if (!body) return;
  if (!rail) {
    rail = Object.assign(document.createElement('nav'), { id: 'flow-rail', className: 'flow-rail' });
    rail.setAttribute('aria-label', 'Groups');
    body.prepend(rail);
  }
  const open = NAV_GROUPS.find(g => g.tabs.includes(tab))?.id;
  const shown = g => (typeof _navShownIn === 'function' ? _navShownIn(g) : g.tabs);
  const item = g => {
    const n = shown(g).length;
    return n ? `<button type="button" class="flow-rail-item${g.id === open ? ' active' : ''}" data-group="${escHtml(g.id)}" onclick="navGroup(${jsArg(g.id)})"
      title="${escHtml(shown(g).map(t => NAV_LABELS[t] || t).join(', '))}"${g.id === open ? ' aria-current="true"' : ''}>
      <span class="pt"></span><span class="flow-rail-name">${escHtml(g.label)}</span>${n > 1 ? `<span class="flow-rail-count">${n}</span>` : ''}</button>` : '';
  };
  rail.innerHTML = `<div class="flow-rail-groups">${NAV_GROUPS.filter(g => g.id !== 'settings').map(item).join('')}</div>
    <div class="flow-rail-foot">${NAV_GROUPS.filter(g => g.id === 'settings').map(item).join('')}<div class="flow-readout" id="flow-readout"></div></div>`;
}

/** On a phone in Flow, a group in the bottom bar opens at once: its pages are the chips above. */
const flowPhoneGroups = () => flowOn() && window.matchMedia('(max-width: 768px)').matches;

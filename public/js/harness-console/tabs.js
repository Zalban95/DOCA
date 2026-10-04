/* ═══════════════════════════════════════════════════════
   Harness → tabs over the conversations you have open (asked 2026-10-04,
   after the Projects chat got them). The Orchestrator is the first tab and
   stays; a conversation opened from the list on the side becomes a tab; what
   an open tab starts — a work chat, a specialist — opens beside it once,
   marked ↳; ✕ closes a tab and leaves the conversation in the list. Which tabs
   are open is this browser's (localStorage), like the Projects chat's.
   Drawn with the Projects tabs' styles (projects.css .pj-chat-tabs).
   ═══════════════════════════════════════════════════════ */

const HCT = { open: [], seen: new Set(), rows: [], main: null, loaded: false };

function _hcTabsLoad() {
  if (HCT.loaded) return;
  HCT.loaded = true;
  try { const s = JSON.parse(localStorage.getItem('doca.hc.tabs') || '{}'); HCT.open = s.open || []; HCT.seen = new Set(s.seen || []); } catch {}
}
function _hcTabsSave() { try { localStorage.setItem('doca.hc.tabs', JSON.stringify({ open: HCT.open, seen: [...HCT.seen] })); } catch {} }

/** After the list loads: the Orchestrator first, gone conversations out, new sub-agents of open tabs in. */
function hcTabsSync(rows, main) {
  _hcTabsLoad();
  const first = !HCT.rows.length;
  HCT.rows = rows; HCT.main = main;
  const known = new Set(rows.map(r => r.id));
  HCT.open = HCT.open.filter(id => known.has(id) && id !== main);
  for (const r of rows) {
    if (HCT.seen.has(r.id)) continue;
    HCT.seen.add(r.id);
    if (!first && r.parentId && (r.parentId === main ? false : HCT.open.includes(r.parentId)))
      HCT.open.splice(HCT.open.indexOf(r.parentId) + 1, 0, r.id);
  }
  _hcTabsSave();
  hcTabsRender();
}

/** A conversation being shown is a tab. */
function hcTabsShow(id) {
  _hcTabsLoad();
  if (id && id !== HCT.main && !HCT.open.includes(id)) { HCT.open.push(id); _hcTabsSave(); }
  hcTabsRender();
}

function hcTabsRender() {
  const strip = document.getElementById('hc-tabs');
  if (!strip) return;
  const byId = new Map(HCT.rows.map(r => [r.id, r]));
  const ids = [HCT.main, ...HCT.open].filter(Boolean);
  strip.innerHTML = ids.map(id => {
    const r = byId.get(id) || { title: 'Conversation' };
    const sub = r.kind === 'specialist' || (r.parentId && r.parentId !== HCT.main);
    return `<div class="pj-tab-chat ${id === _hcSession ? 'active' : ''} ${sub ? 'sub' : ''}" role="tab" aria-selected="${id === _hcSession}" data-id="${escHtml(id)}"
        title="${escHtml(`${r.title || ''}${r.mode && r.mode !== 'agent' ? ` · ${r.mode}` : ''}${r.waiting ? ` · ${r.waiting} queued` : ''}`)}">
      ${r.state === 'running' ? '<span class="pj-tab-dot" aria-label="working"></span>' : ''}${sub ? '↳ ' : ''}<span class="pj-tab-name">${escHtml(id === HCT.main ? 'Orchestrator' : r.title || 'Conversation')}</span>
      ${id === HCT.main ? '' : `<button class="pj-tab-x" title="Close the tab (the conversation stays in the list)" data-close="${escHtml(id)}">✕</button>`}</div>`;
  }).join('');
  strip.querySelectorAll('.pj-tab-chat').forEach(el => { el.onclick = e => { if (!e.target.dataset.close && el.dataset.id !== _hcSession) hcOpenSession(el.dataset.id); }; });
  strip.querySelectorAll('[data-close]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const i = HCT.open.indexOf(b.dataset.close);
      HCT.open.splice(i, 1);
      _hcTabsSave();
      if (b.dataset.close === _hcSession) hcOpenSession(HCT.open[Math.max(0, i - 1)] || HCT.main);
      else hcTabsRender();
    };
  });
}

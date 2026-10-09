/* ═══════════════════════════════════════════════════════
   The licence, as every page sees it (modules/license; GET /api/licence): which pages and features this hive is
   not licensed for — left out, never drawn as refusals — and the banner when the licence needs the owner (no licence
   yet within the grace, lapsed, read-only, or a new one waiting for a restart).
   ═══════════════════════════════════════════════════════ */

let LICENCE = { off: { pages: [], features: [] }, banner: null };

let _licenceReady = null;
/** The first read, shared: a page that loads at start waits for it before calling what may not be here. */
function licenceReady() { return _licenceReady || (_licenceReady = licenceLoad()); }

/** Read at start (licenceReady), and again after a change in Settings → System → Licence. */
async function licenceLoad() {
  try { LICENCE = await apiFetch('/api/licence'); } catch { /* signed out, or an older hub: nothing left out */ }
  licenceBannerDraw();
  return LICENCE;
}

/** Whether a page (a nav id, or settings/<sub-tab>) is drawn here. */
const licencePageOn = page => !(LICENCE.off?.pages || []).includes(page);
/** Whether a feature (its id in the feature index) is licensed here: a page asks before calling its routes. */
const licenceFeatureOn = id => !(LICENCE.off?.features || []).includes(id);

function licenceBannerDraw() {
  let el = document.getElementById('licence-banner');
  const b = LICENCE.banner;
  if (!b) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'licence-banner';
    el.setAttribute('role', 'status');
    document.querySelector('main.content')?.prepend(el);
  }
  const colour = b.level === 'error' ? 'var(--red)' : b.level === 'warn' ? 'var(--amber)' : 'var(--accent)';
  el.style.cssText = `margin:0 0 12px;padding:8px 12px;border:1px solid ${colour};border-radius:var(--radius);color:var(--text);background:var(--surface);font-size:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap`;
  el.innerHTML = `<span class="pt" style="background:${colour}"></span><span style="flex:1;min-width:200px">${escHtml(b.text)}</span>`
    + (typeof authHasRight !== 'function' || authHasRight('host') ? '<button class="btn btn-sm" onclick="settingsSubNav(\'system\');setTimeout(()=>document.getElementById(\'licence-card\')?.scrollIntoView({block:\'start\'}),300)">Licence</button>' : '');
}

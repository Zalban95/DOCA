/* ═══════════════════════════════════════════════════════
   Flow: the opening (docs/design/flow-experience.md). On a cold load — the first in this browser tab — the pages
   are warmed behind a calm screen: the face's own points (faceMount, unchanged), a slowly turning ring of points,
   the product's name and the groups ticking ready. It appears only when warming takes noticeable time (never a
   fixed delay), never waits on live data, steps aside after a few seconds whatever is left (warming carries on
   behind), and a tap or a key dismisses it. A later load in the same tab warms in the background, unseen.
   ═══════════════════════════════════════════════════════ */

const FLOW_OPENING = { showAfterMs: 300, atMostMs: 4000 };

function _flowOpeningName() {
  return (typeof BRAND !== 'undefined' && BRAND?.product) || document.querySelector('[data-brand="product"]')?.textContent || '';
}

/** The opening screen, drawn: the groups each with its pages to warm. */
function _flowOpeningEl(order) {
  const el = Object.assign(document.createElement('div'), { id: 'flow-opening', className: 'flow-opening' });
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const groups = NAV_GROUPS.filter(g => g.id !== 'settings');
  el.innerHTML = `<div class="flow-opening-mark"><span class="flow-ring">${Array.from({ length: 24 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</span><canvas width="120" height="120"></canvas></div>
    <div class="flow-opening-name">${escHtml(_flowOpeningName())}</div>
    <div class="flow-opening-say">Getting your pages ready — once, now; then every page opens at once.</div>
    <div class="flow-opening-bar"><span></span></div>
    <ul class="flow-opening-groups">${groups.map(g => `<li data-group="${escHtml(g.id)}"><span class="pt"></span>${escHtml(g.label)}</li>`).join('')}</ul>
    <button type="button" class="btn btn-xs flow-opening-skip">Skip</button>`;
  return el;
}

function _flowOpeningStep(el, done, order) {
  const bar = el.querySelector('.flow-opening-bar span');
  if (bar) bar.style.width = `${order.length ? Math.round(100 * done.length / order.length) : 100}%`;
  for (const li of el.querySelectorAll('.flow-opening-groups li')) {
    const g = NAV_GROUPS.find(x => x.id === li.dataset.group);
    const mine = order.filter(t => g?.tabs.includes(t));
    li.classList.toggle('ready', mine.every(t => done.includes(t)));
  }
}

/** Warm the pages; on a cold load, behind the opening screen when that takes noticeable time. */
async function flowOpening() {
  let cold = false;
  try { cold = !sessionStorage.getItem('doca.flow.opened'); sessionStorage.setItem('doca.flow.opened', '1'); } catch { cold = false; }
  if (!cold) return flowWarm();
  let el = null, face = null, gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    clearTimeout(show);
    clearTimeout(cap);
    document.removeEventListener('keydown', close, true);
    if (!el) return;
    el.classList.add('leaving');
    setTimeout(() => { face?.stop(); el.remove(); }, 200);
  };
  const show = setTimeout(async () => {
    if (gone) return;
    el = _flowOpeningEl(_flowWarm?.order || []);
    document.body.append(el);
    el.querySelector('.flow-opening-skip').onclick = close;
    el.addEventListener('click', close);
    document.addEventListener('keydown', close, true);
    _flowOpeningStep(el, _flowWarm?.done || [], _flowWarm?.order || []);
    try { if (typeof faceMount === 'function') face = faceMount(el.querySelector('canvas'), { ...(typeof faceSpec === 'function' ? await faceSpec() : {}), dots: 160, hud: false, grain: false, vignette: false }); face.set('thinking'); }
    catch { /* the ring alone */ }
    if (gone) face?.stop();
  }, FLOW_OPENING.showAfterMs);
  const cap = setTimeout(close, FLOW_OPENING.showAfterMs + FLOW_OPENING.atMostMs);
  const result = await flowWarm((done, order) => { if (el) _flowOpeningStep(el, done, order); });
  close();
  return result;
}

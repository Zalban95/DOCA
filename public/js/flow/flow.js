/* ═══════════════════════════════════════════════════════
   Flow — an experience beside the looks (Settings → General → Appearance; docs/design/flow-experience.md).
   A look (look.js) is the shape of things and a theme their colours; an experience is how the panel opens and
   moves. Standard is the panel as it always was, and with it nothing below does anything. Flow:
     · warms the pages once when the panel opens (flow/warm.js), behind an opening screen only on a cold load
       that takes noticeable time (flow/opening.js);
     · moves between pages in a fifth of a second, in CSS (css/flow.css), never with reduced motion;
     · draws the person's own groups on a side rail, or the phone's as chips over a bar (flow/rail.js).
   It is the screen setting `experience` (modules/experience), kept in this browser too so the page opens in it
   before the hub answers. It never changes what a page does, and uses the screen's own theme variables.
   ═══════════════════════════════════════════════════════ */

const FLOW_DEFAULTS = { mode: 'standard', warm: 'all', motion: 'gentle', groups: 'rail' };
const FLOW_CHOICES = { mode: ['standard', 'flow'], warm: ['all', 'used'], motion: ['gentle', 'quick', 'none'], groups: ['rail', 'top'] };

/** Every field one of its choices, anything else its default (the hub's modules/experience/index.js, held equal by a test). */
function flowNormalize(v) {
  const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return Object.fromEntries(Object.keys(FLOW_DEFAULTS).map(k => [k, FLOW_CHOICES[k].includes(src[k]) ? src[k] : FLOW_DEFAULTS[k]]));
}

let _flow = (() => { try { return flowNormalize(JSON.parse(localStorage.getItem('doca.experience') || 'null')); } catch { return flowNormalize(null); } })();

/** Flow is on for this screen — never on a page served alone (solo.js) or in the calm everyday view (focused/). */
const flowOn = () => _flow.mode === 'flow' && !(typeof soloOn === 'function' && soloOn())
  && document.documentElement.dataset.mode !== 'focused';
const flowGet = () => ({ ..._flow });

/** Mark the page for css/flow.css; Standard takes every mark away, so it is exactly the panel it was. */
function _flowMark() {
  const root = document.documentElement;
  if (_flow.mode !== 'flow') { for (const k of ['experience', 'flowMotion', 'flowGroups', 'flowMove']) delete root.dataset[k]; return; }
  root.dataset.experience = 'flow';
  root.dataset.flowMotion = _flow.motion;
  root.dataset.flowGroups = _flow.groups;
}

/** The screen's experience, from its settings (settings.js at start, `boot`; the Appearance card when changed). */
function flowApply(v, { boot = false } = {}) {
  _flow = flowNormalize(v);
  try { localStorage.setItem('doca.experience', JSON.stringify(_flow)); } catch { /* the screen setting still holds it */ }
  _flowMark();
  if (typeof flowRailDraw === 'function') flowRailDraw();
  if (_flow.mode === 'flow' && typeof flowWarmStart === 'function') flowWarmStart({ opening: boot });   // once: warming is kept
  return flowGet();
}

/* ── Visits: which pages this screen uses most (warm: used), and whether a page was drawn before ── */

const _flowSeen = new Set();
let _flowVisits = (() => { try { return JSON.parse(localStorage.getItem('doca.flow.visits') || '{}') || {}; } catch { return {}; } })();

function _flowCount(page) {
  _flowVisits[page] = (_flowVisits[page] || 0) + 1;
  try { localStorage.setItem('doca.flow.visits', JSON.stringify(_flowVisits)); } catch { /* forgets */ }
}

/** The pages this screen opened most, most first. */
const flowUsedMost = (n = 6) => Object.entries(_flowVisits).sort((a, b) => b[1] - a[1]).slice(0, n).map(([p]) => p);

/** flow/warm.js says a page has been drawn once, off screen. */
const flowSeen = page => _flowSeen.add(page);

/* ── Moving between pages: nav() calls these two around its own work ── */

let _flowLeaving = null, _flowT0 = 0;

/** Before the new page shows: the old one is kept on screen for its fade, and the move is a group's or a page's. */
function flowNavBefore(from, to) {
  if (!flowOn()) return;   // Standard: nothing measured, counted or moved
  _flowT0 = performance.now();
  _flowCount(to);
  if (!from || from === to) return;
  const root = document.documentElement, plain = t => !String(t).startsWith('view-');
  const gi = t => NAV_GROUPS.findIndex(g => g.tabs.includes(t));
  const a = gi(from), b = gi(to);
  root.dataset.flowMove = a === b ? 'page' : 'group';
  root.style.setProperty('--flow-dx', `${b < a ? -12 : 12}px`);
  clearTimeout(_flowLeaving?.timer);
  _flowLeaving?.el.classList.remove('flow-leaving');
  const el = plain(from) && plain(to) ? document.getElementById(`tab-${from}`) : null;
  if (!el || _flow.motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) { _flowLeaving = null; return; }
  el.classList.add('flow-leaving');
  _flowLeaving = { el, timer: setTimeout(() => el.classList.remove('flow-leaving'), _flow.motion === 'quick' ? 80 : 120) };
}

/** After it shows: the title takes the focus once it settles, and the readout says how long it took. */
function flowNavAfter(to) {
  if (!flowOn()) return;
  const warm = _flowSeen.has(to);
  _flowSeen.add(to);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const ms = Math.round(performance.now() - _flowT0);
    const out = document.getElementById('flow-readout');
    if (out) out.textContent = `opened in ${ms} ms${warm ? ' · warm' : ''}`;
    document.documentElement.dataset.flowLast = String(ms);
  }));
  const settle = { gentle: 220, quick: 120, none: 0 }[_flow.motion] ?? 220;
  setTimeout(() => {
    if (currentTab !== to) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('nav, #flow-rail, header, .mobile-nav')) return;   // never from what the person is typing in
    const title = document.querySelector(`#tab-${to} .page-title, #tab-${to} .card-title`);
    if (!title) return;
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: true });
  }, settle);
}

// The page opens in the experience this browser last used, before the hub answers (as look.js does for the look).
_flowMark();

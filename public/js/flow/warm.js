/* ═══════════════════════════════════════════════════════
   Flow: the pages warmed once, when the panel opens (docs/design/flow-experience.md).
   Each page's first drawing — its markup filled from the hub — is done off screen with the same functions nav()
   calls for it, one page at a time while the browser is idle, so opening it later shows it at once and only
   refreshes in place. A page is warmed only with what draws once: nothing here opens a live stream, a hold (the
   Workstream's sentinel, Home's connection), a picture timer (Live) or a terminal. Those pages keep their
   "only while shown" rule and are not in FLOW_WARM; their first drawing is markup already in the page.
   test/flow-experience.test.js holds every function named here to the one nav() calls for that page.
   ═══════════════════════════════════════════════════════ */

const FLOW_WARM = {
  harness: async () => {   // DOCA's own console only: another harness's console opens a terminal
    if (typeof _harnesses !== 'undefined' && !_harnesses.length) await harnessLoad();
    if ((_harnesses || []).find(x => x.isDefault)?.kind === 'builtin') harnessTabInit();
  },
  archive: () => archiveInit(),
  models: async () => {
    await modelsInit();
    if (typeof modelsRolesCard === 'function') modelsRolesCard();
    if (typeof decisionModelsTab === 'function') decisionModelsTab();
    if (typeof wakewordTab === 'function') wakewordTab();
    if (typeof libraryTab === 'function') libraryTab();
  },
  mcp: () => mcpInit(),
  docker: () => dockerInit(),
  vms: () => vmsInit(),
  connectors: () => fieldPageShow('connectors'),
  apikeys: () => fieldPageShow('apikeys'),
};

const FLOW_WARM_CAP = { pages: 12, eachMs: 4000, allMs: 15000 };

let _flowWarming = false;   // true while pages are warmed: a refusal they meet is not asked (lib/switch-ask.js)
let _flowWarm = null;   // {order, done, started} while warming, then kept for the opening screen and the tests

/** The pages to warm, in order: the open group's first, then the others' as the person's groups go. */
function flowWarmOrder(cfg = flowGet()) {
  const here = typeof _navShown === 'function' ? NAV_TABS.filter(t => _navShown(t)) : NAV_TABS.slice();
  const open = NAV_GROUPS.find(g => g.tabs.includes(currentTab));
  const byGroup = [...(open ? open.tabs : []), ...NAV_GROUPS.flatMap(g => g.tabs)];
  let list = [...new Set(byGroup)].filter(t => FLOW_WARM[t] && here.includes(t) && t !== currentTab);
  if (cfg.warm === 'used') { const used = flowUsedMost(6); list = used.length ? list.filter(t => used.includes(t)) : list.slice(0, 6); }   // nothing counted yet: the first six
  return list.slice(0, FLOW_WARM_CAP.pages);
}

const _flowIdle = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(r, 16)));

/** Warm the pages once; `onStep(done, order)` after each. Resolves when done or out of time. */
async function flowWarm(onStep = () => {}) {
  if (_flowWarm) return _flowWarm.promise;
  const order = flowWarmOrder(), started = performance.now();
  _flowWarm = { order, done: [], started, finished: false };
  _flowWarm.promise = (async () => {
    _flowWarming = true;
    try {
    for (const page of order) {
      if (performance.now() - started > FLOW_WARM_CAP.allMs) break;
      await _flowIdle();
      if (page === currentTab) { _flowWarm.done.push(page); onStep(_flowWarm.done, order); continue; }   // opened meanwhile: drawn by nav()
      try {
        await Promise.race([Promise.resolve(FLOW_WARM[page]()), new Promise(r => setTimeout(r, FLOW_WARM_CAP.eachMs))]);
      } catch { /* a page that fails to warm opens as it always did */ }
      flowSeen(page);
      _flowWarm.done.push(page);
      onStep(_flowWarm.done, order);
    }
    } finally { _flowWarming = false; }
    _flowWarm.finished = true;
    _flowWarm.ms = Math.round(performance.now() - started);
    return _flowWarm;
  })();
  return _flowWarm.promise;
}

/** Start warming once the first page is shown — at the panel's start behind the opening screen on a cold load
    (flow/opening.js); when Flow is chosen in Settings, unseen. */
function flowWarmStart({ opening = false } = {}) {
  if (!flowOn() || _flowWarm) return;
  if (opening && typeof flowOpening === 'function') flowOpening();
  else flowWarm();
}

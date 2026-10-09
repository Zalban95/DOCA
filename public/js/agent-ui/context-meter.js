/* ═══════════════════════════════════════════════════════
   How much a conversation uses (the usage meter), and the token rate.
   Shared by chat.js, the harness console and the Projects chat.
   ═══════════════════════════════════════════════════════ */

/* ── The usage meter (2026-10-09, replacing the dotted ring) ────────────────
   One meter in every chat — the floating chat, the Harness console, Controls,
   a Projects chat tab — drawn from the same objects, so it means the same
   thing wherever it is: `budget.report()` on a `usage` event while a turn runs,
   `status().context` when a conversation is opened, and the person's own
   budget from GET /api/spending (agent-ui/usage-budget.js).

   It shows a number with its unit beside a thin bar, and the bar is always
   "used over a limit":
   - the limit closest to being reached — the context window when one is
     declared (with the fold point, where older messages become a summary, as
     a tick), or the person's token budget for today or this month;
   - with no limit at all, this turn against 1,000,000 tokens — a scale, not a
     limit, and the card says so — with the last turns left as heat chips.
   The colour walks the heat map from a light cool cyan through green, yellow
   and orange to red (tokens `--heat-0…4` per ground in css/usage-meter.css,
   mixed in OKLCH so the steps look even). Never colour alone: the number and
   the fill length say the same. The hover title — and on a touch screen a tap
   — is the card: each line a plain sentence. Nothing measured is "—", never 0.
   Numbers and fixed words only, so the templates are safe. */

const USAGE_TURN_SCALE = 1e6;          // no limit: a turn is drawn against this
const USAGE_TRACE = 6;                 // finished turns kept as chips
const _usageState = new Map();         // key (a conversation) → { steps, current, trace, last }
const _usageSlots = new Map();         // element id → [u, key, opts]: redrawn when the budget arrives
const USAGE_SHORT = { 'this turn': 'turn', 'this month': 'month' };   // where a header has room for one short word
const USAGE_FROM = { own: 'set by you', admin: 'set by an admin', leader: 'set by your team leader', level: "your level's default" };

/** A fraction 0…1 as a colour on the heat map. */
function usageHeat(f) {
  f = Math.max(0, Math.min(1, Number(f) || 0));
  const p = f * 4, i = Math.min(3, Math.floor(p)), t = Math.round((p - i) * 100);
  return `color-mix(in oklch, var(--heat-${i + 1}) ${t}%, var(--heat-${i}))`;
}

function _usageK(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  return n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
}

/**
 * Fold a report into the state kept for `key`: a usage event with fewer steps
 * than the last one is a new turn, so the last one becomes a chip.
 * A report without `steps` (a conversation just opened), or one already
 * folded in (a tab shown again), changes nothing kept.
 */
function _usageTrack(key, u) {
  if (!key) return null;
  const s = _usageState.get(key) || { steps: 0, current: null, trace: [] };
  if (u && u !== s.last && Number.isFinite(Number(u.steps)) && Number(u.steps) > 0) {   // the same event drawn again is not a new step
    s.last = u;
    const steps = Number(u.steps);
    if (s.current && steps <= s.steps) s.trace = [...s.trace, s.current].slice(-USAGE_TRACE);
    s.steps = steps;
    s.current = { tokens: Math.max(0, Number(u.totalTokens) || 0), est: u.source === 'estimated',
      in: Number(u.promptTokens) || 0, out: Number(u.completionTokens) || 0, cached: u.cachedTokens ?? null };
  }
  _usageState.set(key, s);
  return s;
}

/** The limits that apply now, each as { used, max, unit, line }, plus this turn's line. */
function _usageLimits(u, s, budget) {
  const out = [];
  const win = Number(u?.contextWindow) || 0;
  if (win) {
    const used = Math.max(0, Number(u.contextTokens) || 0), fold = Math.min(100, Math.max(0, Number(u.compactPercent) || 0));
    out.push({ used, max: win, unit: 'context', fold,
      line: `Context: ${_usageK(used)} of the model's ${_usageK(win)} window (set in the agent's ⚙).`
        + (fold ? ` Past ${fold}%, older messages fold into a summary.` : '') });
  }
  const b = budget?.budget || {};
  if (b.tokensPerDay?.limit) out.push({ used: budget.today, max: b.tokensPerDay.limit, unit: 'today',
    line: `Today: ${_usageK(budget.today)} of your ${_usageK(b.tokensPerDay.limit)} budget, ${USAGE_FROM[b.tokensPerDay.from] || 'set in Settings → Spending'}.` });
  if (b.tokensPerMonth?.limit) out.push({ used: budget.month, max: b.tokensPerMonth.limit, unit: 'this month',
    line: `This month: ${_usageK(budget.month)} of your ${_usageK(b.tokensPerMonth.limit)} budget, ${USAGE_FROM[b.tokensPerMonth.from] || 'set in Settings → Spending'}.` });
  return out;
}

/**
 * The meter's HTML ('' for a harness that reports no usage). `key` names the
 * conversation (a session id, or the chat's own slot) so the finished turns'
 * chips belong to it.
 */
function usageMeterHtml(u, key = null, { tap = false } = {}) {
  // `undefined` is a harness that reports nothing (not the built-in one): no meter, rather than one that never moves.
  if (u === undefined && !(key && _usageState.get(key)?.current)) return '';
  const s = _usageTrack(key, u);
  const cur = s?.current || null;
  const limits = _usageLimits(u, s, typeof usageBudget === 'function' ? usageBudget() : null);
  const est = u?.source === 'estimated' || cur?.est;
  const turnLine = cur
    ? `This turn: ${_usageK(cur.tokens)} tokens (${_usageK(cur.in)} read${cur.cached != null ? `, ${_usageK(cur.cached)} of them cached` : ''}, ${_usageK(cur.out)} written)`
    : 'This turn: nothing measured yet';
  let shown, lines, trace = '';
  if (limits.length) {
    shown = limits.reduce((a, b) => (b.used / b.max > a.used / a.max ? b : a));
    lines = [...limits.map(l => l.line), `${turnLine}.`];
  } else {
    shown = { used: cur ? cur.tokens : null, max: USAGE_TURN_SCALE, unit: 'this turn' };
    lines = [cur ? `This turn: ${_usageK(cur.tokens)} of 1M — no limit set.` : 'This turn: nothing measured yet — no limit set.',
      `Each turn is drawn against 1M tokens: a scale, not a limit.${cur ? ` ${turnLine.replace('This turn: ', 'It used ')}.` : ''}`];
    if (s?.trace.length) lines.push(`Turns before: ${s.trace.map(t => _usageK(t.tokens)).join(', ')}.`);
    trace = `<span class="um-trace" aria-hidden="true">${(s?.trace || []).map(t => {
      const f = t.tokens / USAGE_TURN_SCALE;
      return `<i style="--um-c:${usageHeat(f)};height:${(6 + 8 * Math.sqrt(Math.min(1, f))).toFixed(1)}px"></i>`;
    }).join('')}</span>`;
  }
  if (est) lines.push('Estimated: this provider reports no token counts.');
  const card = lines.join('\n');
  const f = shown.used == null ? 0 : shown.used / shown.max;
  const width = shown.used ? Math.max(4, Math.min(100, f * 100)) : 0;
  const num = shown.used == null ? '—' : `${est && shown.unit !== 'today' && shown.unit !== 'this month' ? '~' : ''}${_usageK(shown.used)}`;
  return `<span class="usage-meter um-${shown.unit === 'this turn' ? 'turn' : 'limit'}" role="meter" aria-valuemin="0"`
    + ` aria-valuemax="${shown.max}"${shown.used == null ? '' : ` aria-valuenow="${shown.used}"`}`
    + ` aria-label="${escHtml(lines[0])}" title="${escHtml(card)}"${tap ? ' data-tap="1"' : ''}>${trace}`
    + `<span class="um-bar"><span class="um-fill" style="--um-c:${usageHeat(f)};width:${width.toFixed(1)}%"></span>`
    + (shown.fold && shown.fold < 100 ? `<span class="um-fold" style="left:${shown.fold}%"></span>` : '')
    + `</span><span class="um-label"><span class="um-num">${num}</span><span class="um-of"> of ${_usageK(shown.max)}</span>`
    + `<span class="um-unit"> ${shown.unit}</span><span class="um-unit-short"> ${USAGE_SHORT[shown.unit] || shown.unit}</span></span></span>`;
}

/** Draw the meter into `el` for the conversation `key`; it is drawn again when the person's budget arrives. */
function usageMeterDraw(el, u, key, opts) {
  if (!el) return;
  if (el.id) _usageSlots.set(el.id, [u, key, opts]);
  el.innerHTML = usageMeterHtml(u, key, opts);
  if (typeof usageBudgetRefresh === 'function') usageBudgetRefresh();
}

/** Redraw every meter on the page (the budget changed); the same events again are no new steps. */
function usageMetersRedraw() {
  for (const [id, [u, key, opts]] of _usageSlots) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = usageMeterHtml(u, key, opts); else _usageSlots.delete(id);
  }
}

// A tap on a touch screen shows the card a hover shows, under the meter; a second tap or any other closes it.
// (Guarded: tests load this file into a DOM stand-in that has no listeners.)
if (typeof document.addEventListener === 'function') document.addEventListener('click', ev => {
  const pop = document.getElementById('um-pop');
  const m = ev.target.closest?.('.usage-meter[data-tap]');
  if (pop && (!m || pop.dataset.for === m.title)) { pop.remove(); if (m) return; }
  if (!m || !matchMedia('(hover: none)').matches) return;
  const p = document.createElement('div');
  p.id = 'um-pop'; p.className = 'um-pop'; p.dataset.for = m.title; p.textContent = m.title;
  document.body.appendChild(p);
  const r = m.getBoundingClientRect();
  p.style.top = `${r.bottom + 6}px`;
  p.style.left = `${Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.left))}px`;
});

/**
 * How fast the answer came, as one quiet line under it.
 *
 * Model time only: `budget` measures around the provider call, so a turn that
 * spent forty seconds in a shell command is not reported as a slow model.
 * Null when nothing measured it — a rate is either a measurement or nothing.
 */
function tokenRateEl(u) {
  const rate = Number(u?.tokensPerSecond);
  if (!rate) return null;
  const el = document.createElement('div');
  el.className = 'turn-meta';
  el.textContent = `${rate} tok/s`;
  el.title = 'Generation speed across this turn\'s model calls — the time inside the model, '
    + 'not the tools it ran between them.'
    + (u.source === 'estimated' ? ' Token counts estimated: this provider reports none.' : '');
  return el;
}

/* ═══════════════════════════════════════════════════════
   The person's own token budget, for the usage meter (agent-ui/context-meter.js).

   A budget is a limit like the context window, so the meter shows it the same way — "today: 2.1M of your 5M budget,
   set by you". Read from GET /api/spending (right `read`: your own spend and budget, modules/spending/routes.js),
   at most once a minute and only while a meter is drawn; a person without a token budget costs one read a minute.
   What it holds is as of that read: the meter never adds a guess to it.
   ═══════════════════════════════════════════════════════ */

const _USAGE_BUDGET = { at: 0, data: null, busy: false };

/** { budget, today, month } for the signed-in person, or null before the first read or without a token budget. */
function usageBudget() {
  const b = _USAGE_BUDGET.data;
  return b && (b.budget?.tokensPerDay || b.budget?.tokensPerMonth) ? b : null;
}

/** Read it again when the last read is older than a minute (or `force`); meters are redrawn when it changed. */
async function usageBudgetRefresh(force = false) {
  if (_USAGE_BUDGET.busy || (!force && Date.now() - _USAGE_BUDGET.at < 60000) || typeof apiFetch !== 'function') return;
  _USAGE_BUDGET.busy = true; _USAGE_BUDGET.at = Date.now();
  try {
    const { me } = await apiFetch('/api/spending');
    const next = { budget: me?.budget || null, today: Number(me?.today?.tokens) || 0, month: Number(me?.tokens) || 0 };
    const was = JSON.stringify(_USAGE_BUDGET.data);
    _USAGE_BUDGET.data = next;
    if (JSON.stringify(next) !== was && typeof usageMetersRedraw === 'function') usageMetersRedraw();
  } catch { /* not signed in, or an older hub: the meter goes on without a budget */ }
  finally { _USAGE_BUDGET.busy = false; }
}

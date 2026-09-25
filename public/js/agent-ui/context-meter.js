/* ═══════════════════════════════════════════════════════
   How full the context window is, and the token rate.
   Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

/* ── How full the window is ────────────────────────────
   Both chats draw the same ring from the same object — `budget.report()` on a
   `usage` event while a turn runs, `status().context` when one is opened — so
   the panel and the console cannot end up describing the window differently. */

/**
 * The context window as a ring, plus the numbers in words.
 *
 * Three arcs: the whole window, the part past the fold point in light orange,
 * and how much is used on top of both. The orange is not a warning — it is the
 * region the transcript only keeps as a summary once the conversation reaches
 * it, which is a different fact from "nearly full" and needs its own colour.
 *
 * Returns '' when no window is declared. `contextWindow` defaults to 0 = nobody
 * has said, and a ring drawn against a number we invented would be a
 * measurement nobody made.
 *
 * Numbers only, so the template is safe; nothing here comes from the model.
 */
function contextRingHtml(u) {
  const win = Number(u?.contextWindow) || 0;
  if (!win) return '';
  const used = Math.max(0, Number(u.contextTokens) || 0);
  const pct  = Math.min(100, Math.round((used / win) * 100));
  const fold = Math.min(100, Math.max(0, Number(u.compactPercent) || 0));

  const R = 7, C = 2 * Math.PI * R;
  // Arcs start at 3 o'clock, so the group is rotated to put zero at the top.
  const arc = (cls, frac, from = 0) =>
    `<circle class="${cls}" cx="9" cy="9" r="${R}" fill="none" stroke-width="3"`
    + ` stroke-dasharray="${(C * Math.max(0, frac)).toFixed(2)} ${C.toFixed(2)}"`
    + ` stroke-dashoffset="${(-C * from).toFixed(2)}"></circle>`;
  const k = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

  const title = `Context: ${used.toLocaleString()} of ${win.toLocaleString()} tokens (${pct}%)`
    + (fold ? `. Older messages fold into a summary past ${fold}%.` : '.')
    + (u.source === 'estimated' ? ' Estimated — this provider reports no token counts.' : '');

  // The fold band goes on top of the used arc, not under it: it is translucent,
  // so the overlap reads as used-and-past-the-fold in one ring. Drawn
  // underneath it would vanish at exactly the moment it starts to matter.
  return `<span class="ctx-ring" title="${escHtml(title)}">`
    + '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">'
    + '<g transform="rotate(-90 9 9)">'
    + arc('ctx-track', 1)
    + arc('ctx-used', pct / 100)
    + (fold && fold < 100 ? arc('ctx-fold', 1 - fold / 100, fold / 100) : '')
    + '</g></svg>'
    + `<span class="ctx-label">${k(used)} / ${k(win)}</span></span>`;
}

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

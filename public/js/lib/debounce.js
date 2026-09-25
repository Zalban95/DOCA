/* ═══════════════════════════════════════════════════════
   Debounce.
   ═══════════════════════════════════════════════════════ */

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} ms
 */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

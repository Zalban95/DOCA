/* ═══════════════════════════════════════════════════════
   Process output boxes: reveal one, and append streamed text to it.
   ═══════════════════════════════════════════════════════ */

/**
 * Append streamed text to a <pre>/output element and keep it scrolled.
 * Common companion to sseStream's onStatus.
 * @param {HTMLElement} el
 * @param {string} text
 */
function appendStream(el, text) {
  if (!el) return;
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

/**
 * Reveal a streaming output box and bring it into view so the process
 * lines are visible from the first chunk.
 * @param {HTMLElement} el
 * @param {string} [initialText]
 */
function showStream(el, initialText = '') {
  if (!el) return;
  el.style.display = 'block';
  el.textContent = initialText;
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

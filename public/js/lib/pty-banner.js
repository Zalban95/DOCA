/* ═══════════════════════════════════════════════════════
   The banner a terminal shows when node-pty is missing.
   ═══════════════════════════════════════════════════════ */

/**
 * Show a "node-pty missing" error banner inside a terminal container.
 * Only shown when the WS connection fails before ever opening.
 * @param {HTMLElement} container - the xterm container element
 */
function ptyErrorBanner(container) {
  if (!container || container.querySelector('.term-pty-error')) return;
  const el = document.createElement('div');
  el.className = 'term-pty-error';
  el.innerHTML = `
    <span class="term-pty-error-icon">⚠</span>
    <div class="term-pty-error-body">
      <strong>Terminal unavailable</strong>
      <span>The Terminal needs node-pty, which is not built on this machine. Its row in System tools builds it, with no restart — where Build tools is missing, install that row first.</span>
      <div class="term-pty-error-actions">
        <button class="btn btn-xs btn-teal" onclick="sysdepsShow()">Open Settings → System → System tools</button>
      </div>
    </div>`;
  container.style.position = 'relative';
  container.appendChild(el);
}

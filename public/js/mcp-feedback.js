/* ═══════════════════════════════════════════════════════
   What a click on the MCP page did, seen (self-test 2026-10-08: Accept and Connect changed nothing a person could
   see until the request came back, so a click that landed and one that missed looked the same). The button says it
   is working the moment it is pressed and cannot be pressed twice; the row that changed is brought into view and
   lit once, its status line saying what happened — or, in words, what did not.
   ═══════════════════════════════════════════════════════ */

/** The pressed button, busy: disabled, its label saying what is happening. Returns how to put it back. */
function mcpBusy(btn, label) {
  if (!btn || !btn.isConnected) return () => {};
  const was = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('mcp-busy');
  btn.textContent = label;
  return () => { if (btn.isConnected) { btn.disabled = false; btn.classList.remove('mcp-busy'); btn.innerHTML = was; } };
}

/** After the list was drawn again: the server's row in view, lit once, and its line saying how it went. */
function mcpShowResult(id, msg, cls) {
  const line = document.getElementById(`mcp-status-${id}`);
  const card = line?.closest('.mcp-card');
  if (!line) return false;
  setStatus(line, msg, cls, cls === 'err' || cls === 'warn' ? { clear: 0 } : { clear: 8000 });   // what still needs a click stays
  if (card) {
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.classList.remove('mcp-flash'); void card.offsetWidth; card.classList.add('mcp-flash');
  }
  return true;
}

/* ═══════════════════════════════════════════════════════
   Harness tab: what the agent is told.
   ═══════════════════════════════════════════════════════ */

/* ── What the agent is told ───────────────────────────── */

async function hcEnvOpen() {
  const overlay = document.getElementById('hc-env-overlay');
  const out     = document.getElementById('hc-env-out');
  if (!overlay || !out) return;
  overlay.style.display = 'flex';
  out.textContent = 'Loading…';
  try {
    const data = await apiFetch(`/api/harness/environment?sessionId=${encodeURIComponent(_hcSession)}`);
    out.textContent = `${data.prompt || data.charter + '\n\n' + data.block}\n\n${data.readings || ''}\n\n${data.context ? `Estimated context: ${data.context.total} tokens; ${data.context.tools.count} tools; recent history cap ${data.context.transcript.kept} rows (current turn kept whole).` : ''}`;
  } catch (e) { out.textContent = e.message; }
}

function hcEnvClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hc-env-overlay');
  if (overlay) overlay.style.display = 'none';
}

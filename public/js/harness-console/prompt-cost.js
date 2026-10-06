/* Harness → the context ring → what one step costs (GET /api/harness/prompt; audit 2026-10-06, coh F5/F17, TODO C5b):
   every block of the system prompt as it is assembled, the tools by owner, the transcript, the step and the worst case.
   The percentage of the window answers "will it fit"; this answers "what am I paying for each step". */
async function hcPromptOpen() {
  let overlay = document.getElementById('hc-prompt-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'hc-prompt-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    overlay.innerHTML = `<div class="modal" style="max-width:640px"><div class="modal-title">What one step costs</div>
      <div id="hc-prompt-body" style="overflow-x:auto;font-size:12px"></div>
      <small class="harness-hint">Every step re-sends all of this: the system prompt, the tools' schemas and the conversation so far.
        A provider's cache bills a repeated prefix at a fraction, but it is still sent. Figures are estimates (≈4 characters a token)
        unless the provider reported its own.</small>
      <div class="toolbar-right mt8"><button class="btn btn-xs" onclick="document.getElementById('hc-prompt-overlay').style.display='none'">close</button></div></div>`;
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  const body = overlay.querySelector('#hc-prompt-body');
  body.textContent = 'Measuring…';
  let b;
  try { b = await apiFetch(`/api/harness/prompt?sessionId=${encodeURIComponent(typeof _hcSession !== 'undefined' && _hcSession ? _hcSession : '')}`); }
  catch (e) { body.textContent = e.message; return; }
  const n = v => Number(v || 0).toLocaleString();
  const row = (name, tokens, note) => `<tr><td style="padding:2px 10px 2px 0">${escHtml(name)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${n(tokens)}</td><td style="padding-left:10px;color:var(--muted)">${escHtml(note || '')}</td></tr>`;
  body.innerHTML = `<table style="width:100%;border-collapse:collapse">
    ${b.sections.map(s => row(s.name, s.tokens, s.note)).join('')}
    ${(b.tools?.byOwner || []).map(o => row(`tools: ${o.owner} (${o.count})`, o.tokens, '')).join('')}
    ${row(`conversation (${b.transcript?.messages || 0} messages)`, b.transcript?.tokens, b.transcript?.note)}
    <tr><td style="padding-top:6px;font-weight:600">Each step</td><td style="text-align:right;font-weight:600;padding-top:6px">${n(b.perStep)}</td><td></td></tr>
    <tr><td>Worst case (× ${n(b.maxSteps)} steps)</td><td style="text-align:right">${n(b.worstCase)}</td><td style="padding-left:10px;color:var(--muted)">harness.config.doca.maxSteps</td></tr></table>`;
}

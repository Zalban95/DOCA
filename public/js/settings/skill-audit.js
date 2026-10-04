/* ═══════════════════════════════════════════════════════
   Settings → Harness → Skills: a skill written for another harness
   (modules/harness/skill-audit.js) — what in it is not DOCA's, the mechanical
   rewrite side by side, Adapt to write it and Restore to undo.
   ═══════════════════════════════════════════════════════ */

async function skillAuditOpen(name) {
  let overlay = document.getElementById('skill-audit-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'skill-audit-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    overlay.appendChild(Object.assign(document.createElement('div'), { className: 'modal', id: 'skill-audit-modal' }));
    document.body.appendChild(overlay);
  }
  const modal = document.getElementById('skill-audit-modal');
  modal.style.maxWidth = '1100px';
  modal.innerHTML = '<div class="placeholder pulse">Reading…</div>';
  overlay.style.display = 'flex';
  let a, p;
  try {
    a = await apiFetch(`/api/harness/skills/${encodeURIComponent(name)}/audit`);
    p = await apiFetch(`/api/harness/skills/${encodeURIComponent(name)}/adapt`, { method: 'POST', body: {} });
  } catch (e) { modal.textContent = e.message; return; }
  const row = f => `<li>${f.line ? `<small>line ${f.line}</small> ` : ''}${escHtml(f.what)} → ${f.fix ? `<strong>${escHtml(f.fix)}</strong>` : `<em style="color:var(--amber)">review: ${escHtml(f.review)}</em>`}</li>`;
  modal.innerHTML = `
    <div class="modal-title">${escHtml(name)} — ${a.status === 'ready' ? 'written for DOCA' : `written for ${escHtml(a.label || 'another harness')}`}</div>
    <p class="harness-hint">Until it is adapted the agent still uses it, translating as it reads. Adapting rewrites the tool names and
      placeholders below for good; lines marked review need a person (or ask the agent to finish them). The original is kept for Restore.</p>
    <ul style="font-size:12px;margin:8px 0 12px 18px">${a.findings.map(row).join('') || '<li>Nothing left to change.</li>'}</ul>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div><div class="harness-hint">Now</div><pre class="skill-audit-pre"></pre></div>
      <div><div class="harness-hint">Adapted for DOCA${p.remaining.length ? ` — ${p.remaining.length} left for review` : ''}</div><pre class="skill-audit-pre"></pre></div>
    </div>
    <div class="toolbar-right mt8">
      <span class="status-line" id="skill-audit-status"></span>
      ${a.hasOriginal ? '<button class="btn btn-xs" id="skill-audit-restore">Restore original</button>' : ''}
      ${a.status === 'adapt' && a.source === 'local' && p.after !== p.before ? '<button class="btn btn-xs btn-blue" id="skill-audit-apply">Adapt for DOCA</button>' : ''}
      <button class="btn btn-xs" id="skill-audit-close">close</button>
    </div>`;
  const [before, after] = modal.querySelectorAll('.skill-audit-pre');
  for (const pre of [before, after]) pre.style.cssText = 'white-space:pre-wrap;font-size:11px;max-height:50vh;overflow:auto;margin:0;padding:8px;background:var(--bg2);border:1px solid var(--border)';
  before.textContent = p.before; after.textContent = p.after;
  modal.querySelector('#skill-audit-close').onclick = () => { overlay.style.display = 'none'; };
  const act = (id, url, body) => modal.querySelector(id)?.addEventListener('click', async () => {
    try { await apiFetch(url, { method: 'POST', body }); docaSkillsLoad(); skillAuditOpen(name); }
    catch (e) { document.getElementById('skill-audit-status').textContent = e.message; }
  });
  act('#skill-audit-apply', `/api/harness/skills/${encodeURIComponent(name)}/adapt`, { apply: true });
  act('#skill-audit-restore', `/api/harness/skills/${encodeURIComponent(name)}/restore`, {});
}

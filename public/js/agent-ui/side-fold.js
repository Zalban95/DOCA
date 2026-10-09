/* ═══════════════════════════════════════════════════════
   What is lined up for a conversation, folded beside its composer (asked
   2026-10-04: "everything that is queued … folding on the side of the chat"):
   the messages waiting for the agent's next step (modules/harness/inbox.js),
   each one withdrawable, and its plan with each step's state — and, in a
   project's chat, the teams working on the project with their members
   (`teams`: {list, open, doc} — a function giving them, and the globals a
   member's conversation and the document open with; agent-ui/team-members.js). One line when
   folded; nothing at all when there is nothing lined up.
   ═══════════════════════════════════════════════════════ */

const AGENT_FOLD_STEP = { done: '✓', running: '●', blocked: '⚠', queued: '○' };

/** @returns {{ refresh(): Promise<void>, setSession(id): void }} */
function agentSideFold(host, sessionId, { teams = null } = {}) {
  let id = sessionId, open = false, last = [[], null];
  try { open = localStorage.getItem('doca.fold.open') === '1'; } catch {}
  const render = (waiting, plan) => {
    last = [waiting, plan];
    const steps = plan?.steps || [];
    const done = steps.filter((_, i) => plan.progress?.[i + 1] === 'done').length;
    const crews = (typeof teams?.list === 'function' && teams.list()) || [];
    if (!waiting.length && !plan && !crews.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const parts = [waiting.length ? `Queued ${waiting.length}` : '', plan ? `Plan ${done}/${steps.length} · ${plan.fulfilledAt ? 'fulfilled' : plan.state}` : '',
      crews.length ? `${crews.length === 1 ? `Team ${crews[0].title}` : `${crews.length} teams`} · ${crews.reduce((n, t) => n + (t.members?.specialists || []).filter(s => s.state === 'running').length, 0)} working` : ''].filter(Boolean);
    host.innerHTML = `<button class="agent-fold-head" aria-expanded="${open}">${open ? '▾' : '▸'} ${escHtml(parts.join(' · '))}</button>
      <div class="agent-fold-body" ${open ? '' : 'hidden'}>
        ${waiting.map(w => `<div class="agent-fold-q"><span>${escHtml(w.message)}</span>
          <button class="btn btn-xs" title="Withdraw it before it is read" data-q="${escHtml(w.id)}">✕</button></div>`).join('')}
        ${plan ? `<div class="agent-fold-plan"><div class="agent-fold-title">${escHtml(plan.title)}</div>
          ${steps.map((st, i) => { const s = plan.progress?.[i + 1] || 'queued';
            const c = plan.contracts?.[i]?.done;   // the step's contract: finished means it holds
            return `<div class="agent-fold-step" data-state="${s}"><span>${AGENT_FOLD_STEP[s] || '○'}</span> ${escHtml(st)}${c ? `<small style="display:block;color:var(--muted);margin-left:18px">done when ${escHtml(c)}</small>` : ''}</div>`; }).join('')}</div>` : ''}
        ${crews.map(t => teamCardHtml(t, { open: teams.open, doc: teams.doc, compact: true })).join('')}
      </div>`;
    host.querySelector('.agent-fold-head').onclick = () => {
      open = !open;
      try { localStorage.setItem('doca.fold.open', open ? '1' : '0'); } catch {}
      render(waiting, plan);
    };
    host.querySelectorAll('[data-q]').forEach(b => {
      b.onclick = async () => {
        try { const r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/inbox/${encodeURIComponent(b.dataset.q)}`, { method: 'DELETE' }); render(r.waiting, plan); }
        catch (e) { appAlert(e.message); }
      };
    });
  };
  const refresh = async () => {
    if (!id) { render(...last); return; }
    try { const r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/inbox`); render(r.waiting || [], r.plan); }
    catch { render([], null); }
  };
  refresh();
  return { refresh, setSession: next => { id = next; refresh(); } };
}

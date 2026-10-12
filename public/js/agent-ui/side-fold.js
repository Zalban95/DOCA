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

const AGENT_FOLD_STEP = { done: '✓', running: '●', blocked: '⚠', queued: '○', cancelled: '–' };

/** A background job of the main chat in a line (experiment alwaysFree; modules/harness/background.js rows). */
function agentFoldJobHtml(r) {
  const st = r.ended ? `${r.state}${r.unread ? ' · unread' : ''}` : r.state === 'queued' ? 'lined up' : r.state === 'waiting' ? 'waiting for its specialists'
    : r.plan?.at ? `step ${r.plan.at} of ${r.plan.total}: ${r.plan.text}` : 'working';
  const added = r.added?.length ? `<small class="agent-fold-changed">${r.added.map(a => `step ${a.step} ${a.action === 'add' ? 'added' : 'cancelled'} by you — not read yet`).join(' · ')}</small>` : '';
  return `<div class="agent-fold-step" data-state="${r.ended ? (r.state === 'done' ? 'done' : 'blocked') : 'running'}"><span>${r.ended ? (r.state === 'done' ? '✓' : '⚠') : '●'}</span>
    <a href="#" data-open-job="${escHtml(r.id)}">${escHtml(r.title)}</a> <small style="color:var(--muted)">${escHtml(st)}</small>${added}</div>`;
}

/** A plan's flagged change: the person's edits its worker has not read yet (modules/harness/living-plan.js). */
const agentFoldUnread = plan => (plan?.edits || []).filter(e => e.by === 'person' && !e.readAt);

/** @returns {{ refresh(): Promise<void>, setSession(id): void }} */
function agentSideFold(host, sessionId, { teams = null } = {}) {
  let id = sessionId, open = false, last = [[], null];
  try { open = localStorage.getItem('doca.fold.open') === '1'; } catch {}
  const render = (waiting, plan, jobs = []) => {
    last = [waiting, plan, jobs];
    const steps = plan?.steps || [];
    const done = steps.filter((_, i) => plan.progress?.[i + 1] === 'done').length;
    const live = steps.filter((_, i) => plan.progress?.[i + 1] !== 'cancelled').length;
    const changed = agentFoldUnread(plan);
    const crews = (typeof teams?.list === 'function' && teams.list()) || [];
    if (!waiting.length && !plan && !crews.length && !jobs.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const working = jobs.filter(j => !j.ended).length;
    const parts = [jobs.length ? `In the background ${working ? `${working} working` : `${jobs.length} finished`}` : '', waiting.length ? `Queued ${waiting.length}` : '',
      plan ? `Plan ${done}/${live} · ${plan.fulfilledAt ? 'fulfilled' : plan.state}${changed.length ? ' · changed by you' : ''}` : '',
      crews.length ? `${crews.length === 1 ? `Team ${crews[0].title}` : `${crews.length} teams`} · ${crews.reduce((n, t) => n + (t.members?.specialists || []).filter(s => s.state === 'running').length, 0)} working` : ''].filter(Boolean);
    host.innerHTML = `<button class="agent-fold-head" aria-expanded="${open}">${open ? '▾' : '▸'} ${escHtml(parts.join(' · '))}</button>
      <div class="agent-fold-body" ${open ? '' : 'hidden'}>
        ${waiting.map(w => `<div class="agent-fold-q"><span>${escHtml(w.message)}</span>
          <button class="btn btn-xs" title="Withdraw it before it is read" data-q="${escHtml(w.id)}">✕</button></div>`).join('')}
        ${jobs.length ? `<div class="agent-fold-plan"><div class="agent-fold-title">In the background</div>${jobs.map(agentFoldJobHtml).join('')}</div>` : ''}
        ${plan ? `<div class="agent-fold-plan"><div class="agent-fold-title">${escHtml(plan.title)}</div>
          ${changed.length ? `<small class="agent-fold-changed">Changed by ${escHtml(changed[0].who || 'you')}: ${changed.map(e => `step ${e.step} ${e.action === 'add' ? 'added' : 'cancelled'}`).join(', ')} — not read by the work chat yet</small>` : ''}
          ${steps.map((st, i) => { const s = plan.progress?.[i + 1] || 'queued';
            const c = plan.contracts?.[i]?.done;   // the step's contract: finished means it holds
            const theirs = plan.from?.[i] === 'person' && i > 0 ? ' <small class="agent-fold-theirs">added by you</small>' : '';   // step 1 of a handed-on job is the request itself
            return `<div class="agent-fold-step" data-state="${s}"><span>${AGENT_FOLD_STEP[s] || '○'}</span> ${escHtml(st)}${theirs}${c ? `<small style="display:block;color:var(--muted);margin-left:18px">done when ${escHtml(c)}</small>` : ''}</div>`; }).join('')}</div>` : ''}
        ${crews.map(t => teamCardHtml(t, { open: teams.open, doc: teams.doc, compact: true })).join('')}
      </div>`;
    host.querySelector('.agent-fold-head').onclick = () => {
      open = !open;
      try { localStorage.setItem('doca.fold.open', open ? '1' : '0'); } catch {}
      render(waiting, plan, jobs);
    };
    host.querySelectorAll('[data-open-job]').forEach(a => {
      a.onclick = e => { e.preventDefault(); if (typeof hcOpenSession === 'function') hcOpenSession(a.dataset.openJob); };
    });
    host.querySelectorAll('[data-q]').forEach(b => {
      b.onclick = () => confirmRemove('this message', 'It has not been read yet; withdrawn, the agent never sees it.', async () => {
        try { const r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/inbox/${encodeURIComponent(b.dataset.q)}`, { method: 'DELETE' }); render(r.waiting, plan, jobs); }
        catch (e) { appAlert(e.message); }
      }, { verb: 'Withdraw' });
    });
  };
  // While a background job works the fold reads again every few seconds, and stops when none does (like the missions bar).
  let timer = null;
  const refresh = async () => {
    clearTimeout(timer); timer = null;
    if (!id) { render(...last); return; }
    try {
      const r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/inbox`);
      render(r.waiting || [], r.plan, r.background || []);
      if ((r.background || []).some(j => !j.ended) && host.isConnected) timer = setTimeout(function tick() { if (document.hidden) timer = setTimeout(tick, 5000); else refresh(); }, 5000);
    } catch { render([], null); }
  };
  refresh();
  return { refresh, setSession: next => { id = next; refresh(); } };
}

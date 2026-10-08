/* Chronicle's right side (modules/chronicle/story.js): the story of one piece of work — a conversation, a mission or one
   run — from its records and traces: what ran, why, what it cost, what failed, and the conversations it started. The
   step-by-step waterfall is the conversation's own trace window (agent-ui/trace-view.js), opened from here. */

async function chronStory(target, rowEl) {
  const box = document.getElementById('chron-story');
  if (!box) return;
  CHRON.picked = target.run || null;
  document.querySelectorAll('#chron-list .chron-row.active').forEach(r => r.classList.remove('active'));
  rowEl?.classList.add('active');
  box.innerHTML = '<div class="chron-empty">Reading…</div>';
  let s;
  try { s = await apiFetch(`/api/chronicle/story?${new URLSearchParams(target)}`); }
  catch (e) { box.innerHTML = `<div class="chron-empty">${escHtml(e.message)}</div>`; return; }
  box.innerHTML = chronStoryHtml(s, target);
  box.scrollTop = 0;
  if (window.matchMedia?.('(max-width: 800px)').matches) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const chronN = n => (n || 0).toLocaleString();

function chronCost(t) {
  if (t.cost == null) return '';
  return `<span>cost</span> <b>${escHtml(t.currency || '')} ${t.cost < 0.01 ? t.cost.toFixed(4) : t.cost.toFixed(2)}</b>`;
}

function chronStoryHtml(s, target) {
  const t = s.totals || {};
  const kind = { mission: '⬡ Mission', orchestrator: '💬 Orchestrator', work: '💬 Conversation', specialist: '⬡ Specialist', job: '⌁ Device job' }[s.kind] || s.kind;
  const open = s.sessionId ? `<button class="btn btn-xs" onclick="chronOpenConversation(${jsArg(s.sessionId)})" title="The conversation itself, in the Harness">Open the conversation</button>
    <button class="btn btn-xs" onclick="traceOpen(${jsArg(s.sessionId)})" title="Every model request and tool call, as a waterfall">⏱ Trace</button>` : '';
  const whole = target.run && s.sessionId ? `<button class="btn btn-xs" onclick="chronStory({session: ${jsArg(s.sessionId)}})">The whole conversation's story</button>` : '';
  const up = s.parentId ? `<button class="btn btn-xs" onclick="chronStory({session: ${jsArg(s.parentId)}})" title="The conversation that started this one">↑ Started by</button>` : '';
  const m = s.mission;
  return `<h3>${escHtml(s.title || '')}</h3>
    <div style="color:var(--muted)">${escHtml(kind || '')}${m ? ` · ${escHtml(m.agent)} · ${escHtml(m.state)}` : ''}</div>
    <div class="toolbar" style="margin:8px 0;gap:6px;flex-wrap:wrap">${open}${whole}${up}</div>
    ${m ? `<div class="chron-why"><b>The errand:</b> ${escHtml(m.task)}</div>
      ${m.plan?.length ? `<div style="color:var(--muted)">Plan: ${m.plan.map(i => `${i.state === 'done' ? '✓' : i.state === 'failed' ? '✗' : '○'} ${escHtml(i.title)}`).join(' · ')}</div>` : ''}
      ${m.planCheck?.length ? `<div class="chron-warn">Ended done with plan items open: ${escHtml(m.planCheck.join('; '))}</div>` : ''}
      ${m.error ? `<div class="chron-bad">${escHtml(m.error)}</div>` : ''}` : ''}
    <div class="chron-kv">
      <span>runs</span> <b>${chronN(t.runs)}</b><span>steps</span> <b>${chronN(t.steps)}</b>
      <span>tokens</span> <b>${chronN(t.tokens)}</b><span>in / out / cached</span> <b>${chronN(t.prompt)} / ${chronN(t.completion)} / ${chronN(t.cached)}</b>
      ${chronCost(t)}<span>time</span> <b>${chronDur(t.ms) || '—'}</b><span>tool calls</span> <b>${chronN(t.toolCalls)}</b>
      ${t.failedTools ? `<span>failed tools</span> <b class="chron-bad">${t.failedTools}</b>` : ''}${t.failedRuns ? `<span>failed runs</span> <b class="chron-bad">${t.failedRuns}</b>` : ''}
    </div>
    ${(s.runs || []).slice().reverse().map(chronRunHtml).join('') || '<div class="chron-empty">No runs kept for it.</div>'}
    ${s.children?.length ? `<div class="card-title" style="margin-top:12px">What it started</div>${s.children.map(c => `<div class="chron-row" onclick="chronStory({session: ${jsArg(c.sessionId)}})">
        <span class="chron-when">${c.updatedAt ? escHtml(chronWhen(c.updatedAt)) : ''}</span><span class="chron-what">${c.kind === 'mission' ? '⬡' : '💬'} ${escHtml(c.title || c.sessionId)}</span>
        <span class="chron-state ${escHtml(c.state || '')}">${escHtml(c.state || '')}</span><span class="chron-meta">${escHtml(c.agent)}</span></div>`).join('')}` : ''}
    ${s.log?.length ? `<div class="card-title" style="margin-top:12px">Its lines in the harness log (since the last start)</div>
      <div class="chron-log">${s.log.map(l => `<span class="${l.level === 'error' ? 'chron-bad' : l.level === 'warn' ? 'chron-warn' : ''}">${escHtml(new Date(l.ts).toLocaleTimeString())} ${escHtml(l.text)}</span>`).join('\n')}</div>` : ''}`;
}

function chronRunHtml(r) {
  const x = r.summary || {};
  const models = Object.entries(x.models || {}).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ');
  const failed = new Set((x.failed || []).map(f => f.name));
  const tools = Object.entries(x.tools || {}).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<span class="chron-tool ${failed.has(k) ? 'bad' : ''}" title="${failed.has(k) ? 'failed at least once' : ''}">${escHtml(k)}${n > 1 ? ` ×${n}` : ''}</span>`).join('');
  const trouble = [
    ...(x.failed || []).map(f => `<span class="chron-bad">✗ ${escHtml(f.name)} at step ${f.step ?? '?'} (${escHtml(f.why)})</span>`),
    x.refused ? `<span class="chron-warn">${x.refused} call${x.refused === 1 ? '' : 's'} refused or denied</span>` : '',
    x.approvals ? `<span>${x.approvals} approval${x.approvals === 1 ? '' : 's'} asked</span>` : '',
    x.failovers ? `<span class="chron-warn">${x.failovers} hop${x.failovers === 1 ? '' : 's'} down the fallback chain</span>` : '',
    ...(x.warnings || []).map(w => `<span class="chron-warn">⚠ ${escHtml(w)}</span>`),
    ...(x.errors || []).map(e => `<span class="chron-bad">${escHtml(e)}</span>`),
  ].filter(Boolean);
  return `<div class="chron-run ${r.state === 'failed' ? 'failed' : ''}">
    <div class="chron-run-head"><span class="chron-state ${escHtml(r.state)}">${escHtml(r.state)}</span>
      <span class="chron-when">${escHtml(new Date(r.at).toLocaleString())}</span><span style="color:var(--muted)">${chronDur(r.ms)}</span>
      <span style="margin-left:auto;color:var(--muted)">${r.steps ?? '—'} steps · ${chronN(r.tokens)} tokens${x.cost != null ? ` · ${x.cost.toFixed(4)}` : ''}</span>
      ${r.sessionId ? `<button class="btn btn-xs" onclick="chronTrace(${jsArg(r.sessionId)}, ${jsArg(r.id)})" title="This run step by step">⏱</button>` : ''}</div>
    <div class="chron-why"><b>Why:</b> ${escHtml(r.why || '')}</div>
    ${models ? `<div style="color:var(--muted)">Answered by ${escHtml(models)} · model ${chronDur(x.modelMs) || '—'}, tools ${chronDur(x.toolMs) || '—'}</div>` : ''}
    ${tools ? `<div class="chron-tools">${tools}</div>` : ''}
    ${(x.thinking || []).length ? `<div style="color:var(--muted)">Thinking: ${x.thinking.map(k => `${escHtml(k.level || 'the model\'s default')}${k.from ? ` (${escHtml(k.from)})` : ''}${k.step ? ` from step ${k.step}` : ''}`).join(' → ')}</div>` : ''}
    ${trouble.length ? `<div style="display:flex;flex-direction:column;gap:2px;margin:4px 0">${trouble.join('')}</div>` : ''}
    ${r.outcome ? `<div style="color:var(--muted)">${r.state === 'failed' ? 'Failed: ' : 'Ended: '}${escHtml(r.outcome)}</div>` : ''}
  </div>`;
}

/** One run's waterfall: the conversation's trace window, opened on that run. */
function chronTrace(sessionId, runId) { traceOpen(sessionId, runId); }

function chronOpenConversation(id) {
  nav('harness');
  if (typeof hcOpenSession === 'function') hcOpenSession(id);
}

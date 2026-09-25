/* ═══════════════════════════════════════════════════════
   Harness tab: sessions — status, context, usage, opening,
   archiving, stopping, plans.
   ═══════════════════════════════════════════════════════ */

/** How full this session's context window is, next to the model badge. */
function _hcContext(u) {
  const el = document.getElementById('hc-context');
  if (el) el.innerHTML = contextRingHtml(u);
}

/** Today's tokens, next to the model badge. */
async function _hcLoadUsage() {
  const el = document.getElementById('hc-usage');
  if (!el) return;
  try {
    const { total } = await apiFetch('/api/harness/usage?days=1&by=kind');
    const tok = total.prompt + total.completion;
    const fmt = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
    el.textContent = total.calls
      ? `24h ${fmt(tok)} tok · ${total.calls} calls${total.cached ? ` · ${Math.round(total.cached / total.prompt * 100)}% cached` : ''}${total.estimated ? ' · ~est' : ''}`
      : '';
  } catch { el.textContent = ''; }
}

async function _hcStatus() {
  const sessionId = _hcSession;
  _hcLoadUsage();
  const badge = document.getElementById('hc-model-badge');
  const st    = document.getElementById('hc-status');
  try {
    const s = await apiFetch(`/api/harness/status${sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''}`);
    if (sessionId !== _hcSession) return;
    // This session's window, as it stands before anything is sent. Each chat
    // has its own, so it is redrawn on every session switch rather than left
    // showing the last one's.
    _hcContext(s.context);
    if (badge) {
      badge.textContent = s.model ? `${s.provider} / ${s.model}` : `${s.provider} / no model`;
      badge.className = `badge ${s.ready && s.reachable ? 'badge-green' : s.ready ? 'badge-amber' : 'badge-red'}`;
    }
    // Standing conditions, not events. "Pick a model" is true until you pick
    // one, and a warning that fades on its own reads as though the problem
    // went away. The third branch deliberately clears, because "nothing is
    // wrong" is the absence of the message rather than a message.
    if (!s.ready)          setStatus(st, 'Pick a model with ⚙ before sending.', 'warn', { clear: 0 });
    else if (!s.reachable) setStatus(st, `Provider unreachable — ${s.error || 'no response'}`, 'warn', { clear: 0 });
    else                   setStatus(st, '', '');
  } catch (e) {
    if (badge) { badge.textContent = 'error'; badge.className = 'badge badge-red'; }
    setStatus(st, e.message, 'err');
  }
}

async function _hcLoadSessions(refreshOnly = false) {
  const el = document.getElementById('hc-sessions');
  if (!el) return;
  try {
    const data = await apiFetch('/api/harness/sessions');
    _hcMainSession = data.main;
    const rows = data.sessions.filter(s => _hcArchived || !s.archivedAt);
    if (!rows.some(s => s.id === _hcSession)) _hcSession = rows.find(s => s.id === data.active)?.id || data.main;
    const drawn = new Set();
    const draw = (s, depth = 0) => {
      if (drawn.has(s.id)) return '';
      drawn.add(s.id);
      const role = s.kind === 'orchestrator' ? '1 · Orchestrator' : s.kind === 'specialist' ? '3 · Specialist' : '2 · Work leader';
      return `<div class="hc-session ${s.id === _hcSession ? 'active' : ''}" data-session="${escHtml(s.id)}"
        style="margin-left:${Math.min(2, depth) * 12}px" onclick="hcOpenSession(${jsArg(s.id)})">
        <span class="hc-session-title"><small>${role}${s.archivedAt ? ' · archived' : ''}</small>${escHtml(s.title)}</span>
        <span class="hc-session-meta">${escHtml(s.state)}${s.unread ? ` · ${s.unread} new` : ''}${s.plan?.state === 'proposed' ? ' · plan?' : ''}</span>
      </div>` + rows.filter(child => child.parentId === s.id).map(child => draw(child, depth + 1)).join('');
    };
    const main = rows.find(s => s.id === data.main);
    el.innerHTML = (main ? draw(main) : '') + rows.filter(s => !drawn.has(s.id)).map(s => draw(s)).join('');
    const selected = rows.find(s => s.id === _hcSession);
    const editing = document.activeElement?.closest('#hc-session-info');
    if (_hcSession && !_hcBusy && (!refreshOnly || !editing && selected?.updatedAt !== _hcSelected?.updatedAt)) await hcOpenSession(_hcSession, true);
    clearTimeout(_hcOrgPoll);
    _hcOrgPoll = setTimeout(() => {
      if (document.body.classList.contains('harness-tab')) _hcLoadSessions(true);
    }, 5000);
  } catch (e) {
    el.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function hcNewSession(planning = false) {
  appPrompt(planning ? 'Name this planning chat' : 'Name this work chat', async title => {
    try {
      const { session } = await apiFetch('/api/harness/sessions', { method: 'POST', body: { title, planning } });
      _hcSession = session.id;
      await _hcLoadSessions();
    } catch (e) { appAlert(e.message); }
  }, planning ? 'Planning work' : 'Work chat');
}

async function hcOpenSession(id, skipReload) {
  if (_hcBusy && id !== _hcSession) return appAlert('Stop or finish this direct turn before switching conversations.');
  _hcSession = id;
  const box = document.getElementById('hc-messages');
  if (!box) return;
  try {
    if (!skipReload) await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    const data = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`);
    if (_hcSession !== id) return;
    const changed = _hcSelected?.id !== id;
    _hcSelected = data.session;
    if (data.session.archivedAt && !_hcArchived) {
      _hcArchived = true;
      const toggle = document.querySelector('.hc-archive-switch input');
      if (toggle) toggle.checked = true;
    }
    _hcSessionInfo(data.session);
    if (changed) _hcStatus();
    box.innerHTML = '';
    if (data.session.summary) _hcAppend('summary', data.session.summary, 'Earlier in this conversation');
    data.messages.forEach(m => {
      if (m.role === 'tool') {
        (m.images || []).forEach(_hcAppendImage);
        _hcAppend('tool-result', m.content, m.name);
      }
      else if (m.role === 'assistant') {
        if (m.reasoning?.text) _hcAppend('thinking', m.reasoning.text);
        if (m.content) _hcAppendContent('assistant', m.content);
        (m.tool_calls || []).forEach(tc =>
          _hcAppend('tool-call', tc.function?.arguments || '', tc.function?.name));
      } else if (m.content) _hcAppend(m.role, m.content, m.from?.name);
      // The transcript stores when each row was written, and a rebuilt turn has
      // no other way to know how long it took — so the newest row carries it and
      // the summary reads the same as it did when the turn was watched. One
      // stamp per message is enough: the summary wants the span, not each row.
      if (m.at && box.lastElementChild) box.lastElementChild.dataset.at = m.at;
    });
    if (!box.children.length) box.innerHTML = '<div class="placeholder">Ask it anything about this machine.</div>';
    // A reopened conversation reads the way it looked when its last turn ended,
    // rather than as every step of every turn laid out again.
    collapseFoldRuns(box);
    document.querySelectorAll('#hc-sessions .hc-session').forEach(el =>
      el.classList.toggle('active', el.dataset.session === id));
  } catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

function _hcSessionInfo(s) {
  const el = document.getElementById('hc-session-info');
  const title = document.getElementById('hc-session-title');
  if (!el) return;
  if (title) title.textContent = s.title;
  const isMain = s.id === _hcMainSession;
  const readonly = s.archivedAt || s.state === 'running';
  const input = document.getElementById('hc-input');
  if (input) {
    input.disabled = !!readonly;
    input.placeholder = s.archivedAt ? 'Recall this chat to continue' : s.state === 'running' ? 'Working — stop it before intervening' : isMain ? 'Message your Orchestrator…' : 'Message directly — superiors will be informed…';
  }
  document.getElementById('hc-send').disabled = !!readonly;
  const p = s.plan;
  el.innerHTML = `<div class="hc-session-toolbar">
    <span>${escHtml(s.kind)} · ${escHtml(s.state)} · ${escHtml(s.provider)} / ${escHtml(s.model || 'no model')} · ${Number(s.tokens || 0).toLocaleString()} tokens</span>
    ${!isMain ? `<button class="btn btn-xs" onclick="hcOpenSession(${jsArg(s.parentId || _hcMainSession)})">↑ Superior</button>` : ''}
    ${s.state === 'running' ? `<button class="btn btn-xs btn-red" onclick="hcSessionStop(${jsArg(s.id)})">Stop turn</button>` : ''}
    ${!isMain ? `<button class="btn btn-xs" onclick="hcSessionArchive(${jsArg(s.id)},${!s.archivedAt})">${s.archivedAt ? 'Recall' : 'Archive'}</button>` : ''}
  </div>
  <p class="hc-session-hint">${isMain ? 'Your main contact. Short decisions and reports here; detailed work stays with its leaders.' : 'Direct interaction: your message, the answer and any failure are flagged to the superior and Orchestrator.'}</p>
  ${s.brief ? `<details><summary>Latest brief</summary><p>${escHtml(s.brief)}</p></details>` : ''}
  ${s.lastError ? `<p class="hc-prop-note">${escHtml(s.lastError)}</p>` : ''}
  <details class="hc-plan" ${p?.state === 'proposed' ? 'open' : ''}>
    <summary>Plan${p ? ` · ${escHtml(p.state)} · revision ${p.revision}` : ' · none yet'}</summary>
    ${p ? `<strong>${escHtml(p.title)}</strong><ol>${p.steps.map((x, i) => `<li>${escHtml(x)} <small>· ${escHtml(p.progress?.[i + 1] || 'queued')}</small></li>`).join('')}</ol><p>${escHtml(p.note || '')}</p>` : '<p>Draft here, or ask this agent to plan the work.</p>'}
    ${p?.state === 'proposed' && !s.archivedAt ? `<div class="hc-plan-actions"><button class="btn btn-xs btn-green" onclick="hcPlanAction('approve',${p.revision})">Approve revision ${p.revision}</button><button class="btn btn-xs" onclick="hcPlanAction('reject',${p.revision})">Reject</button></div><small>Approval records your decision. Ask the responsible chat to execute when ready.</small>` : ''}
    ${!s.archivedAt ? `<details><summary>${p ? 'Edit as a new draft' : 'Create draft'}</summary>
      <input class="input" id="hc-plan-title" aria-label="Plan title" placeholder="Plan title" value="${escHtml(p?.title || '')}">
      <textarea class="input" id="hc-plan-steps" aria-label="Plan steps" rows="4" placeholder="One step per line">${escHtml((p?.steps || []).join('\n'))}</textarea>
      <textarea class="input" id="hc-plan-note" aria-label="Plan notes" rows="2" placeholder="Scope, decisions or acceptance criteria">${escHtml(p?.note || '')}</textarea>
      <button class="btn btn-xs" onclick="hcPlanDraft()">Save draft</button></details>
      ${p && p.state !== 'proposed' ? '<button class="btn btn-xs" onclick="hcPlanAction(\'propose\')">Propose for review</button>' : ''}` : ''}
  </details>
  <details><summary>Reports from below · ${(s.reports || []).filter(n => !n.readAt).length} unread by this agent</summary>
    <small>Reports enter its next turn. Opening this panel does not spend tokens or mark them read.</small>
    ${(s.reports || []).slice(-50).reverse().map(n => `<p class="hc-report"><button class="btn btn-xs" onclick="hcOpenSession(${jsArg(n.from)})">Open source</button> <strong>${escHtml(n.type)}</strong> · ${escHtml(n.by)} · ${escHtml(n.at)}${n.readAt ? ' · seen' : ' · unread'}<br>${escHtml(n.text)}</p>`).join('') || '<p>No reports yet.</p>'}
  </details>`;
}

async function hcSessionArchive(id, on) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { on } });
    await _hcLoadSessions();
  } catch (e) { appAlert(e.message); }
}

async function hcSessionStop(id) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} });
    await _hcLoadSessions();
  } catch (e) { appAlert(e.message); }
}

async function hcPlanAction(action, revision) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(_hcSession)}/plan`, { method: 'POST', body: { action, revision } });
    await hcOpenSession(_hcSession, true);
  } catch (e) { appAlert(e.message); }
}

async function hcPlanDraft() {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(_hcSession)}/plan`, { method: 'POST', body: {
      action: 'draft', title: document.getElementById('hc-plan-title').value,
      steps: document.getElementById('hc-plan-steps').value.split('\n').map(s => s.trim()).filter(Boolean),
      note: document.getElementById('hc-plan-note').value,
    } });
    await hcOpenSession(_hcSession, true);
  } catch (e) { appAlert(e.message); }
}

function hcDeleteSession(id) {
  appConfirm('Delete this conversation and its transcript?', async () => {
    try {
      await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (_hcSession === id) _hcSession = null;
      _hcLoadSessions();
    } catch (e) { appAlert(e.message); }
  });
}

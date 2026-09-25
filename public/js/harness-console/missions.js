/* ═══════════════════════════════════════════════════════
   Harness tab: specialists, their missions, and watching one work.
   ═══════════════════════════════════════════════════════ */

/* ── Specialists and their missions ───────────────────── */

/* A mission runs in its own conversation, so nothing here ever blocks the one
   the user is typing in. That is also why this polls rather than streams: the
   bar is a status light, not a transcript, and the transcript it would be
   showing belongs to a conversation nobody has open. */
let _hcMissionPoll = null;

async function _hcLoadAgents() {
  const box = document.getElementById('hc-agents');
  const sw  = document.getElementById('hc-agents-on');
  if (!box) return;
  try {
    const data = await apiFetch('/api/harness/agents');
    if (sw) sw.checked = !!data.enabled;
    box.innerHTML = (data.agents || []).map(a => _hcAgentHtml(a, data.enabled)).join('')
      || '<div class="placeholder">No specialists defined</div>';
    _hcLoadMissions();
  } catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

function _hcAgentHtml(a, enabled) {
  if (a.broken) return `
    <div class="hc-agent bad" title="${escHtml(a.broken)}">
      <span class="hc-agent-id">${escHtml(a.id)}</span>
      <span class="hc-agent-note" style="color:var(--red)">unreadable definition</span>
    </div>`;
  const tools = (a.tools || []).length ? `${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}` : 'no tools';
  return `
    <div class="hc-agent ${enabled ? '' : 'off'}" title="${escHtml(a.note || '')}">
      <span class="hc-agent-id">${escHtml(a.label || a.id)}</span>
      <span class="hc-agent-note">${escHtml(tools)}${a.builtin ? ' · shipped' : ''}</span>
      <button class="btn btn-xs" onclick="hcAgentEdit(${jsArg(a.id)})" title="Edit this definition">✎</button>
      <button class="btn btn-xs btn-red" onclick="hcAgentDelete(${jsArg(a.id)})"
              title="${a.builtin ? 'Revert to the shipped definition' : 'Delete'}">✕</button>
    </div>`;
}

async function hcAgentsEnable(on) {
  try {
    await apiFetch('/api/harness/agents/enable', { method: 'POST', body: { enabled: !!on } });
    _hcLoadAgents();
  } catch (e) { appAlert(e.message); }
}

async function _hcLoadMissions() {
  const bar = document.getElementById('hc-missions');
  if (!bar) return;
  let rows = [];
  try { rows = (await apiFetch('/api/harness/missions?limit=8')).missions || []; } catch { /* leave the bar as it was */ }

  if (!rows.length) { bar.style.display = 'none'; bar.innerHTML = ''; }
  else {
    bar.style.display = '';
    bar.innerHTML = rows.map(m => `
      <span class="hc-mission ${escHtml(m.state)}" title="${escHtml(m.task || '')}"
            onmouseenter="hcMissionPeek(${jsArg(m.id)}, this)" onmouseleave="hcMissionPeekHide()">
        <span class="hc-mission-dot"></span>
        ${escHtml(m.label || m.agentId)}
        <em>${m.state === 'running' ? `step ${m.steps || 0}` : escHtml(m.state)}</em>
        ${m.sessionId ? `<button class="btn btn-xs" onclick="hcOpenSession(${jsArg(m.sessionId)})">Chat</button>` : ''}
        <button class="btn btn-xs" onclick="hcMissionLog(${jsArg(m.id)})"
                title="Its whole log, which stays open and can be copied">log</button>
        ${m.state === 'running' ? '' : `
        <button class="btn btn-xs" onclick="hcMissionArchive(${jsArg(m.id)})"
                title="Put it away. The mission and its log are kept — this list is what is live, not everything that ever ran.">✕</button>`}
      </span>`).join('');
  }

  // Poll only while something is actually running, and stop when it is not:
  // a timer that outlives the thing it was watching is how a quiet panel ends
  // up making a request a second for the rest of the day.
  const busy = rows.some(m => m.state === 'running');
  if (busy && !_hcMissionPoll) _hcMissionPoll = setInterval(_hcLoadMissions, 3000);
  if (!busy && _hcMissionPoll) { clearInterval(_hcMissionPoll); _hcMissionPoll = null; }
}

/**
 * Put a finished mission away.
 *
 * Archived rather than deleted: the row and its log stay on disk, so the reason
 * a mission failed is still there to be read after the list has been tidied,
 * which is when that question is usually asked. `?all=1` brings them back.
 */
async function hcMissionArchive(id) {
  try {
    await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}/archive`, { method: 'POST', body: {} });
    hcMissionPeekHide();
    _hcLoadMissions();
  } catch (e) { appAlert(e.message); }
}

/* ── Watching a specialist work ────────────────────────
   A mission runs with nobody watching it — that is the point of dispatching one
   — but "nobody watching" turned into "nowhere to look": the bar said `failed`
   and the reason was only in `agents/mission-*.jsonl` on the host. The log was
   always there (`GET /api/harness/missions/:id` returns the mission and its
   events); nothing drew it. Hovering peeks, the button opens it properly. */

/** One event as a line: what ran, and what came back. */
function _hcEventLine(e) {
  const at = String(e.at || '').slice(11, 19);
  if (e.type === 'tool_call')   return `${at}  → ${e.name}(${_hcPrettyArgs(e.args || {}).replace(/\s+/g, ' ').slice(0, 120)})`;
  if (e.type === 'tool_result') return `${at}  ← ${e.name}: ${String(e.result ?? '').replace(/\s+/g, ' ').slice(0, 200)}`;
  if (e.type === 'usage')       return `${at}  · step ${e.step}, ${e.totalTokens || 0} tokens`;
  if (e.type === 'error')       return `${at}  ✗ ${e.text || e.message || ''}`;
  return `${at}  ${e.type}${e.text ? `: ${String(e.text).slice(0, 200)}` : ''}`;
}

/** The mission, its outcome and its log, as the text a person would paste. */
function _hcMissionText(mission, events) {
  const m = mission || {};
  return [
    `${m.id} — ${m.label || m.agentId} — ${m.state}`,
    `task: ${m.task || ''}`,
    `steps: ${m.steps || 0}   tokens: ${m.tokens || 0}   started: ${m.startedAt || '?'}   ended: ${m.endedAt || '—'}`,
    m.error  ? `\nerror:\n${m.error}` : '',
    m.result ? `\nresult:\n${m.result}` : '',
    '', '— log —',
    ...(events || []).map(_hcEventLine),
  ].filter(l => l !== '').join('\n');
}

/* The peek: the last few lines, while the pointer is on the row. Fetched on
   hover rather than polled for every mission, because a bar of six missions
   polling their logs every three seconds is six requests a second for
   something nobody is looking at. */
let _hcPeekFor = null;

async function hcMissionPeek(id, anchor) {
  _hcPeekFor = id;
  let data;
  try { data = await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}`); } catch { return; }
  if (_hcPeekFor !== id) return;                 // the pointer moved on while we asked

  const pop = document.getElementById('hc-mission-peek') || (() => {
    const el = document.createElement('div');
    el.id = 'hc-mission-peek';
    el.className = 'hc-mission-peek';
    document.body.appendChild(el);
    return el;
  })();

  const lines = (data.events || []).slice(-6).map(_hcEventLine);
  const head  = data.mission?.error ? `✗ ${data.mission.error}` : (data.mission?.result || data.mission?.task || '');
  // A failed mission usually logged the same error it ended with; saying it
  // twice in six lines wastes the half of them worth reading. With no error
  // there is nothing to look for, and it cannot be spelled as a default:
  // `includes('')` is true of every string.
  const logged = data.mission?.error && lines.some(l => l.includes(data.mission.error));
  const body   = head && logged ? lines : [head, ...lines];
  pop.textContent = body.filter(Boolean).join('\n') || 'nothing logged yet';

  const r = anchor.getBoundingClientRect();
  pop.style.display = 'block';
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top  = `${r.bottom + 6}px`;
}

function hcMissionPeekHide() {
  _hcPeekFor = null;
  const pop = document.getElementById('hc-mission-peek');
  if (pop) pop.style.display = 'none';
}

/* The log: stays open, refreshes itself while the mission is still running, and
   can be selected and copied — which is the whole reason it is a modal and not
   a bigger tooltip. */
let _hcLogFor = null;
let _hcLogPoll = null;

async function hcMissionLog(id) {
  _hcLogFor = id;
  hcMissionPeekHide();
  const overlay = document.getElementById('hc-mission-overlay');
  if (overlay) overlay.style.display = 'flex';
  await _hcMissionLogLoad();
  if (!_hcLogPoll) _hcLogPoll = setInterval(_hcMissionLogLoad, 3000);
}

async function _hcMissionLogLoad() {
  if (!_hcLogFor) return;
  const body  = document.getElementById('hc-mission-log');
  const title = document.getElementById('hc-mission-title');
  try {
    const data = await apiFetch(`/api/harness/missions/${encodeURIComponent(_hcLogFor)}`);
    const m = data.mission || {};
    if (title) title.textContent = `${m.label || m.agentId || 'Mission'} — ${m.state || '?'}`;
    if (body) {
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
      body.textContent = _hcMissionText(m, data.events);
      if (atEnd) body.scrollTop = body.scrollHeight;   // follow a running one, leave a scrolled reader alone
    }
    // A finished mission has nothing more to say; stop asking.
    if (m.state !== 'running' && _hcLogPoll) { clearInterval(_hcLogPoll); _hcLogPoll = null; }
  } catch (e) {
    if (body) body.textContent = `Could not read the mission: ${e.message}`;
  }
}

function hcMissionLogClose(event) {
  if (event && event.target !== event.currentTarget) return;
  _hcLogFor = null;
  if (_hcLogPoll) { clearInterval(_hcLogPoll); _hcLogPoll = null; }
  const overlay = document.getElementById('hc-mission-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function hcMissionLogCopy(btn) {
  const body = document.getElementById('hc-mission-log');
  if (!body) return;
  try {
    await navigator.clipboard.writeText(body.textContent);
    if (btn) { const was = btn.textContent; btn.textContent = 'copied'; setTimeout(() => { btn.textContent = was; }, 1200); }
  } catch {
    // Clipboard permission is not guaranteed; selecting it is always allowed.
    const range = document.createRange();
    range.selectNodeContents(body);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
}

/* A definition is a JSON file, and this edits it as one rather than as a form.
   The fields are few, they are documented in modules/agents/registry.js, and a
   form would have to be rewritten every time one is added — while the agent
   itself writes these files with no form at all. */

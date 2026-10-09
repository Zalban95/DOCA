/* ═══════════════════════════════════════════════════════
   Harness tab: specialists, their missions, and watching one work.
   ═══════════════════════════════════════════════════════ */

/* ── Specialists and their missions ───────────────────── */

/* A mission runs in its own conversation, so nothing here ever blocks the one
   the user is typing in. That is also why this polls rather than streams: the
   bar is a status light, not a transcript, and the transcript it would be
   showing belongs to a conversation nobody has open. */
let _hcMissionPoll = null;
/* While a person's change to the specialists switch is being sent (and its password asked), a list that was already
   loading must not draw the switch back as the server had it before: on a slow machine that load landed under the
   password prompt and flipped the switch the person had just turned on. */
let _hcAgentsChanging = false;

async function _hcLoadAgents() {
  const box = document.getElementById('hc-agents');
  const sw  = document.getElementById('hc-agents-on');
  if (!box) return;
  try {
    const data = await apiFetch('/api/harness/agents');
    if (sw && !_hcAgentsChanging) sw.checked = !!data.enabled;
    box.innerHTML = (data.agents || []).map(a => _hcAgentHtml(a, data.enabled)).join('')
      || '<div class="placeholder">No specialists defined</div>';
    _hcToFill(data.enabled ? (data.agents || []).filter(a => !a.broken) : []);
    _hcComputerFill();
    _hcLoadMissions();
  } catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

/** The composer's "to": the Orchestrator, or one specialist (shown only when there are some). */
function _hcToFill(agents) {
  const sel = document.getElementById('hc-to');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = `<option value="">Orchestrator</option>${agents.map(a => `<option value="${escHtml(a.id)}">→ ${escHtml(a.label || a.id)}</option>`).join('')}`;
  sel.value = agents.some(a => a.id === keep) ? keep : '';
  sel.style.display = agents.length ? '' : 'none';
}

/** Beside "to": which agents' computer a specialist is sent to work in — the ones not in the Archive (host only). */
async function _hcComputerFill() {
  const sel = document.getElementById('hc-computer');
  if (!sel) return;
  let list = [];
  if ((typeof licenceFeatureOn !== 'function' || licenceFeatureOn('computers'))) try { list = (await apiFetch('/api/computers')).computers || []; } catch { /* not a host: no picker */ }
  const keep = sel.value;
  sel.innerHTML = `<option value="">no computer</option>${list.map(c => `<option value="${escHtml(c.id)}">🖥 ${escHtml(c.name || c.id)} (${escHtml(c.id)})</option>`).join('')}`;
  sel.value = list.some(c => c.id === keep) ? keep : '';
  sel.dataset.count = String(list.length);
  _hcComputerShow();
}

/** Shown only when the message goes to a specialist and there is a computer to choose. */
function _hcComputerShow() {
  const sel = document.getElementById('hc-computer');
  if (sel) sel.style.display = document.getElementById('hc-to')?.value && Number(sel.dataset.count) ? '' : 'none';
}

/** Send the composer's text to one specialist as a mission, and open its log to watch it work. */
async function hcSendMission(agentId, text) {
  try {
    const computer = document.getElementById('hc-computer')?.value || undefined;   // lent to the mission (self-test #8)
    const { mission } = await apiFetch('/api/harness/missions', { method: 'POST', body: { agentId, task: text, computer } });
    _hcAppend('user', text);
    _hcAppend('assistant', `Sent to **${mission.label}** as mission \`${mission.id}\` — it reports back to the Orchestrator when it is done.`);
    _hcLoadMissions();
    hcMissionLog(mission.id);
    return true;
  } catch (e) { appAlert(e.message); return false; }
}

function _hcAgentHtml(a, enabled) {
  if (a.broken) return `
    <div class="hc-agent bad" title="${escHtml(a.broken)}">
      <span class="hc-agent-id">${escHtml(a.id)}</span>
      <span class="hc-agent-note" style="color:var(--red)">unreadable definition</span>
    </div>`;
  const n = a.toolCount ?? (a.tools || []).length;
  const kits = Array.isArray(a.kits) && a.kits.length ? ` (${a.kits.join(', ')})` : '';
  const tools = `${n} tool${n === 1 ? '' : 's'}${kits}`;
  return `
    <div class="hc-agent ${enabled ? '' : 'off'}" title="${escHtml(a.note || '')}">
      <span class="hc-agent-id">${escHtml(a.label || a.id)}</span>
      <span class="hc-agent-note"><a href="#" onclick="hcAgentTools(${jsArg(a.id)});return false" title="What it holds, and why">${escHtml(tools)}</a>${a.builtin ? ' · shipped' : ''}</span>
      <button class="btn btn-xs" onclick="hcAgentEdit(${jsArg(a.id)})" title="Edit this definition">✎</button>
      <button class="btn btn-xs btn-red" onclick="hcAgentDelete(${jsArg(a.id)})"
              title="${a.builtin ? 'Revert to the shipped definition' : 'Delete'}">✕</button>
    </div>`;
}

async function hcAgentsEnable(on) {
  _hcAgentsChanging = true;
  try {
    await apiFetch('/api/harness/agents/enable', { method: 'POST', body: { enabled: !!on } });
    _hcAgentsChanging = false;
    _hcLoadAgents();
  } catch (e) { _hcAgentsChanging = false; appAlert(e.message); _hcLoadAgents(); }   // refused or cancelled: drawn as the server has it, never left on
}

async function _hcLoadMissions() {
  const bar = document.getElementById('hc-missions');
  if (!bar) return;
  let rows = [], auto = [], stopped = [], machines = [];
  try { rows = (await apiFetch('/api/harness/missions?limit=8&live=1')).missions || []; } catch { /* leave the bar as it was */ }
  // Teams (harness-console/teams.js): one row each with its bar; their missions are drawn under them, not twice.
  const teams = typeof hcTeamsLoad === 'function' ? await hcTeamsLoad() : [];
  rows = rows.filter(m => !m.team);
  const teamRows = typeof hcTeamsBarHtml === 'function' ? hcTeamsBarHtml(teams) : '';
  // What works on its own right now, and why (agents/stopping.js) — each with a Stop, so nothing runs out of sight.
  try { ({ auto = [], stopped = [], machines = [] } = await apiFetch('/api/harness/working')); } catch { /* an older hub */ }
  // Finished ones nobody needs any more go to the Archive by themselves (agents/tidy.js): how many did, today.
  let putAway = 0;
  if ((typeof licenceFeatureOn !== 'function' || licenceFeatureOn('missions-tidy'))) try { ({ putAway = 0 } = await apiFetch('/api/harness/missions/tidy')); } catch { /* an older hub */ }

  if (!rows.length && !teamRows && !auto.length && !stopped.length && !machines.length && !putAway) { bar.style.display = 'none'; bar.innerHTML = ''; }
  else {
    bar.style.display = '';
    bar.innerHTML = teamRows + rows.map(m => `
      <span class="hc-mission ${escHtml(m.state)}" title="${escHtml(m.task || '')}"
            onmouseenter="hcMissionPeek(${jsArg(m.id)}, this)" onmouseleave="hcMissionPeekHide()">
        <span class="hc-mission-dot"></span>
        ${escHtml(m.label || m.agentId)}
        <em>${m.state === 'running' ? (m.asking ? `waits for you: ${escHtml(m.asking.what || 'a machine')}` : `step ${m.steps || 0}`) : escHtml(m.state)}</em>
        ${m.sessionId ? `<button class="btn btn-xs" onclick="hcMarkSeen(${jsArg(m.id)}); hcOpenSession(${jsArg(m.sessionId)})">Chat</button>` : ''}
        <button class="btn btn-xs" onclick="hcMarkSeen(${jsArg(m.id)}); hcMissionLog(${jsArg(m.id)})"
                title="Its whole log, which stays open and can be copied">log</button>
        ${m.state === 'running' ? '' : hcMissionPinHtml(m)}
        ${m.state === 'running' ? `<button class="btn btn-xs btn-red" onclick="hcMissionStop(${jsArg(m.id)})"
                title="Stop it at its next step. What sent it waits for you instead of carrying on.">■ Stop</button>` : `
        <button class="btn btn-xs" onclick="hcMissionArchive(${jsArg(m.id)})"
                title="Put it away. The mission and its log are kept — this list is what is live, not everything that ever ran.">✕</button>`}
      </span>`).join('') + auto.map(a => `
      <span class="hc-mission running" title="Working on its own: ${escHtml(a.why)}">
        <span class="hc-mission-dot"></span>${escHtml(String(a.title).slice(0, 40))} <em>${escHtml(a.why)}</em>
        <button class="btn btn-xs" onclick="hcOpenSession(${jsArg(a.sessionId)})">Chat</button>
        <button class="btn btn-xs btn-red" onclick="hcAutoStop(${jsArg(a.sessionId)})" title="Stop this turn; nothing is woken to carry on">■ Stop</button>
      </span>`).join('') + stopped.map(w => `
      <span class="hc-mission cancelled" title="${escHtml(w.why)}">
        <span class="hc-mission-dot"></span>${escHtml(String(w.title).slice(0, 40))} <em>stopped — ${escHtml(w.why)}</em>
        <button class="btn btn-xs" onclick="hcWorkDecide(${jsArg(w.sessionId)}, true)" title="It carries on where it stood">↻ Restart</button>
        <button class="btn btn-xs" onclick="hcWorkDecide(${jsArg(w.sessionId)}, false)" title="End it here; its transcript stays">Drop</button>
      </span>`).join('') + machines.map(m => `
      <span class="hc-mission running" title="Busy with no DOCA turn behind it: ${escHtml(m.who || '')}">
        <span class="hc-mission-dot"></span>${escHtml(String(m.name).slice(0, 40))} <em>${escHtml(m.text || 'busy')} — ${escHtml(m.who || '')}</em>
        <button class="btn btn-xs" onclick="machineGo(${jsArg(m.kind)}, ${jsArg(m.id)}, ${m.kind === 'container' ? 'false' : 'true'})" title="See it">${m.kind === 'container' ? 'Docker' : 'Live'}</button>
      </span>`).join('') + hcMissionsTidyHtml(rows, putAway);
  }

  // Poll only while something is actually running, and stop when it is not:
  // a timer that outlives the thing it was watching is how a quiet panel ends
  // up making a request a second for the rest of the day.
  const busy = rows.some(m => m.state === 'running') || teams.some(t => t.state === 'running') || auto.length > 0 || machines.length > 0;
  if (busy && !_hcMissionPoll) _hcMissionPoll = setInterval(_hcLoadMissions, 3000);
  if (!busy && _hcMissionPoll) { clearInterval(_hcMissionPoll); _hcMissionPoll = null; }
}

/**
 * Its person opened a finished result: read means done (modules/harness/seen.js) — it leaves this bar, every device
 * clears its notice quietly, and its conversation stays. Running work and someone else's work are left as they are.
 */
async function hcMarkSeen(id) {
  try { const r = await apiFetch(`/api/harness/seen/${encodeURIComponent(id)}`, { method: 'POST', body: {} }); if (r.seen) setTimeout(_hcLoadMissions, 400); } catch { /* an older hub */ }
}

/** ■ Stop on a running specialist: at its next step, and what sent it waits instead of carrying on. */
async function hcMissionStop(id) {
  try { await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  setTimeout(_hcLoadMissions, 600);
}

/** Work a person stopped: carry it on, or drop it (harness/stopped-work.js). */
async function hcWorkDecide(sessionId, go) {
  try { await apiFetch(`/api/harness/work/${encodeURIComponent(sessionId)}/${go ? 'restart' : 'drop'}`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  setTimeout(_hcLoadMissions, 600);
}

/** ■ Stop on a conversation working on its own (an automatic turn). */
async function hcAutoStop(sessionId) {
  try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
  setTimeout(_hcLoadMissions, 600);
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

/* ═══════════════════════════════════════════════════════
   Harness tab: teams (modules/teams) — specialists on one board, drawn from what the hub works out: a task's state
   and percentage from its mission and its contract, the team's from tasks done (every task counts the same). Nothing
   here is written by an agent. In the missions bar a team is one row with its bar, opened into its tasks; the side
   list holds the teams; the board opens in a window with the keep-going switch, the document and Stop.
   ═══════════════════════════════════════════════════════ */

let _hcTeams = [];
const _hcTeamOpenRows = new Set();   // teams opened into their tasks in the bar (this page only)
let _hcTeamBoard = null;              // the team whose board window is open

const _tmPt = s => ({ running: 'pt-up pt-run', paused: 'pt-ask', checking: 'pt-up pt-run', queued: 'pt-up', waiting: '', done: 'pt-done', failed: 'pt-err', stopped: 'pt-stopped' })[s] ?? '';
const _tmSame = 'Tasks done of tasks — every task counts the same';

/** One thin bar: neutral accent while it moves, red only for a failed task. */
function _tmBar(percent, state, wide = false) {
  return `<span class="tm-bar${wide ? ' wide' : ''}${state === 'failed' ? ' failed' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(percent) || 0}">`
    + `<span class="tm-fill" style="width:${Math.max(0, Math.min(100, Number(percent) || 0))}%"></span></span>`;
}

/** A task's state in the board's own words (teams/board.js `say`). */
function _tmSay(t, team) {
  const name = id => (team.tasks.find(x => x.id === id)?.title || id);
  if (t.state === 'running' || t.state === 'paused') return `${t.state}${t.budget ? `, step ${t.step} of ${t.budget}` : ''}`;
  if (t.state === 'waiting') return `waiting on ${(t.waitingOn || []).map(name).join(', ')}${t.blockedBy ? ' (did not finish)' : ''}`;
  if (t.state === 'checking') return 'checking its contract';
  if (t.state === 'done') return t.contract?.check ? 'done — its contract holds' : t.contract ? 'done — on its specialist\'s word (no check)' : 'done';
  return `${t.state}${t.why ? ` — ${t.why}` : ''}`;
}

const _tmWho = a => (a === 'work' ? 'a work chat' : a);

/** The missions bar's rows: running teams, and those that ended in the last hour. */
function hcTeamsBarHtml(teams) {
  const hour = Date.now() - 3600e3;
  return (teams || []).filter(t => t.state === 'running' || Date.parse(t.endedAt || 0) > hour).map(t => {
    const open = _hcTeamOpenRows.has(t.id), p = t.progress || { done: 0, total: 0, percent: 0 };
    return `<div class="hc-team ${escHtml(t.state)}">
      <button type="button" class="hc-team-head" aria-expanded="${open}" onclick="hcTeamToggle(${jsArg(t.id)})" title="${escHtml(_tmSame)}">
        <span class="pt ${_tmPt(t.state)}"></span><span class="hc-team-name">Team · ${escHtml(t.title)}</span>
        ${_tmBar(p.percent, t.state === 'failed' ? 'failed' : '')}<span class="tm-num">${p.done} of ${p.total} · ${p.percent}%</span>
        <em>${escHtml(t.state === 'running' ? (t.loop?.on ? `keeps going · round ${t.loop.rounds || 0} of ${t.maxRounds}` : 'running') : t.state)}</em>
      </button>
      <button class="btn btn-xs" onclick="hcTeamOpen(${jsArg(t.id)})" title="The board, the team's document and its switches">Board</button>
      ${t.state === 'running' ? `<button class="btn btn-xs btn-red" onclick="hcTeamStop(${jsArg(t.id)})" title="Stop every task: the running ones at their next step; the rest never start">■ Stop</button>` : ''}
      ${open ? `<div class="hc-team-tasks">${t.tasks.map(x => _tmTaskRow(x, t)).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function _tmTaskRow(x, team) {
  return `<div class="tm-task ${escHtml(x.state)}">
    <span class="pt ${_tmPt(x.state)}"></span>
    <span class="tm-task-name" title="${escHtml(x.contract?.done ? `Done when ${x.contract.done}` : '')}">${escHtml(x.title)} <small>${escHtml(_tmWho(x.agent))}</small></span>
    ${_tmBar(x.percent, x.state)}<span class="tm-num">${x.state === 'running' || x.state === 'done' ? `${x.percent}%` : ''}</span>
    <span class="tm-state">${escHtml(_tmSay(x, team))}</span>
    ${x.missionId ? `<button class="btn btn-xs" onclick="hcMissionLog(${jsArg(x.missionId)})" title="Its specialist's log">log</button>` : ''}
  </div>`;
}

function hcTeamToggle(id) {
  if (_hcTeamOpenRows.has(id)) _hcTeamOpenRows.delete(id); else _hcTeamOpenRows.add(id);
  _hcLoadMissions();
}

/** The side list: every team not put away, newest first. */
function hcTeamsSide(teams) {
  const box = document.getElementById('hc-teams');
  if (!box) return;
  box.innerHTML = (teams || []).slice(0, 10).map(t => `
    <button type="button" class="hc-agent hc-team-side" onclick="hcTeamOpen(${jsArg(t.id)})" title="${escHtml(_tmSame)}">
      <span class="pt ${_tmPt(t.state)}"></span><span class="hc-agent-id">${escHtml(t.title)}</span>
      ${_tmBar(t.progress?.percent || 0, t.state === 'failed' ? 'failed' : '')}<span class="tm-num">${t.progress?.percent || 0}%</span>
    </button>`).join('')
    || '<div class="placeholder">No teams yet. When a job needs several specialists, the Orchestrator makes one.</div>';
}

/** Read the teams: the bar and the side list draw from the same answer. */
async function hcTeamsLoad() {
  // Teams are part of the agents' licence: without it the routes are not there, and nothing here asks for them.
  if (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('teams')) {
    document.getElementById('hc-teams')?.parentElement?.querySelectorAll('#hc-teams, .hc-teams-head').forEach(el => { el.hidden = true; });
    return (_hcTeams = []);
  }
  try { _hcTeams = (await apiFetch('/api/harness/missions/teams')).teams || []; } catch { _hcTeams = []; }
  hcTeamsSide(_hcTeams);
  if (_hcTeamBoard) _hcTeamBoardDraw();
  return _hcTeams;
}

/* ── The board ──────────────────────────────────────── */

function hcTeamOpen(id) {
  _hcTeamBoard = id;
  let overlay = document.getElementById('hc-team-overlay');
  if (!overlay) {
    overlay = Object.assign(document.createElement('div'), { id: 'hc-team-overlay', className: 'modal-overlay' });
    overlay.addEventListener('click', e => { if (e.target === overlay) hcTeamClose(); });
    overlay.innerHTML = '<div class="modal tm-board" role="dialog" aria-modal="true" aria-labelledby="hc-team-title"><div id="hc-team-body">Loading…</div></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  overlay._release?.();
  overlay._release = typeof overlayBack === 'function' ? overlayBack(() => { overlay._release = null; hcTeamClose(true); }) : null;
  _hcTeamBoardDraw(true);
}

function hcTeamClose(fromBack = false) {
  _hcTeamBoard = null;
  const overlay = document.getElementById('hc-team-overlay');
  if (overlay) overlay.style.display = 'none';
  if (!fromBack && overlay?._release) { const r = overlay._release; overlay._release = null; r(); }
}

async function _hcTeamBoardDraw(fetchIt = false) {
  const body = document.getElementById('hc-team-body');
  if (!body || !_hcTeamBoard) return;
  let t = _hcTeams.find(x => x.id === _hcTeamBoard);
  if (fetchIt || !t) try { t = (await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(_hcTeamBoard)}`)).team; } catch (e) { body.textContent = e.message; return; }
  const p = t.progress || { done: 0, total: 0, percent: 0 };
  const running = t.state === 'running';
  const actions = `${t.doc?.name ? `<button class="btn btn-sm" onclick="agentDocOpen({name:${jsArg(t.doc.name)}, caption:${jsArg(`Team: ${t.title}`)}})" title="The team's document, written again at every change">Document</button>` : ''}
    ${running ? `<button class="btn btn-sm btn-red" onclick="hcTeamStop(${jsArg(t.id)})">■ Stop the team</button>`
      : `<button class="btn btn-sm" onclick="hcTeamArchive(${jsArg(t.id)})" title="Put it away. The team, its missions and its document are kept">Put away</button>`}
    <button class="btn btn-sm" onclick="hcTeamClose()">Close</button>`;
  const notes = (t.notes || []).slice(-12).reverse();
  body.innerHTML = `${pageHeadHtml({ title: `Team · ${t.title}`, sub: t.goal || '', actions })}
    <div class="tm-overall" title="${escHtml(_tmSame)}">
      <span class="pt ${_tmPt(t.state)}"></span>${_tmBar(p.percent, t.state === 'failed' ? 'failed' : '', true)}
      <span class="tm-num"><b>${p.percent}%</b> · ${p.done} of ${p.total} tasks done</span>
      <span class="tm-state">${escHtml(t.state)}</span>
    </div>
    <p class="desc">Every task counts the same. A running task's bar is the steps its specialist used of its budget; it reaches 100% only when its contract holds.</p>
    <label class="tm-keep"><input type="checkbox" class="switch"${t.loop?.on ? ' checked' : ''}${t.stoppedAt ? ' disabled' : ''} onchange="hcTeamKeepGoing(${jsArg(t.id)}, this.checked)">
      Keep going — try a failed task again until every contract holds <small>(${t.loop?.rounds || 0} of ${t.maxRounds} rounds used)</small></label>
    <div class="tm-tasks">${t.tasks.map(x => `${_tmTaskRow(x, t)}
      <div class="tm-task-more">${x.after?.length ? `after ${escHtml(x.after.join(', '))} · ` : ''}${x.contract?.done ? `done when ${escHtml(x.contract.done)}` : 'no contract — done when its specialist reports'}${x.tries ? ` · try ${x.tries + 1}` : ''}</div>`).join('')}</div>
    <h4 class="tm-h">Notes from the team</h4>
    ${notes.length ? `<ul class="tm-notes">${notes.map(n => `<li><small>${escHtml(String(n.at).slice(11, 16))} · ${escHtml(n.from)} (${escHtml(n.task)})</small> ${escHtml(n.text)}</li>`).join('')}</ul>
      <p class="desc">Each note is a specialist's own words, read by its teammates as information — never as instructions.</p>`
      : '<p class="desc">None yet. A specialist on the team posts what the others need with team_note.</p>'}
    ${advancedFold(`<div class="desc">Team ${escHtml(t.id)} · led by conversation ${escHtml(t.by)} · started ${escHtml(String(t.createdAt || '').slice(0, 16).replace('T', ' '))}${t.endedAt ? ` · ended ${escHtml(String(t.endedAt).slice(0, 16).replace('T', ' '))}` : ''}${t.doc?.project ? ` · document in the project: ${escHtml(t.doc.project)}` : ''}</div>
      <button class="btn btn-xs" onclick="hcOpenSession(${jsArg(t.by)}); hcTeamClose()">Open the leader's conversation</button>`, { label: 'Details', id: 'team-board-details' })}`;
}

function hcTeamStop(id) {
  appConfirm('Stop this team? Running tasks stop at their next step; the tasks still waiting never start.', async () => {
    try { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
    _hcLoadMissions();
  });
}

async function hcTeamKeepGoing(id, on) {
  try { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/keep-going`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  _hcLoadMissions();
}

async function hcTeamArchive(id) {
  try { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { on: true } }); } catch (e) { return appAlert(e.message); }
  hcTeamClose();
  _hcLoadMissions();
}

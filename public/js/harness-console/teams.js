/* ═══════════════════════════════════════════════════════
   Harness tab: teams (modules/teams) — specialists on one board, drawn from what the hub works out: a task's state
   and percentage from its mission and its contract, the team's from tasks done (every task counts the same). Nothing
   here is written by an agent. In the missions bar a team is one row with its bar, opened into its tasks; the side
   list holds the teams; Board opens the team on Agents → Teams (teams-page.js), its plan, members and project.
   ═══════════════════════════════════════════════════════ */

let _hcTeams = [];
const _hcTeamOpenRows = new Set();   // teams opened into their tasks in the bar (this page only)

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
  box.innerHTML = ((teams || []).length ? `<button type="button" class="hc-agent hc-team-side" onclick="nav('teams')" title="Every team, its plan and its project">All teams →</button>` : '') + (teams || []).slice(0, 10).map(t => `
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
  return _hcTeams;
}

/* ── The board: a page of its own (Agents → Teams, teams-page.js) ── */

/** The missions bar, the side list and Projects open a team's board on the Teams page. */
function hcTeamOpen(id) { teamsPageOpen(id); }

/** After a switch: the bar, and the Teams page when it is shown. */
function _hcTeamRedraw() {
  if (typeof _hcLoadMissions === 'function') _hcLoadMissions();
  if (typeof pageShown === 'function' && pageShown('teams') && typeof teamsPageLoad === 'function') teamsPageLoad();
}

function hcTeamStop(id) {
  appConfirm('Stop this team? Running tasks stop at their next step; the tasks still waiting never start.', async () => {
    try { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); } catch (e) { return appAlert(e.message); }
    _hcTeamRedraw();
  });
}

async function hcTeamKeepGoing(id, on) {
  try { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/keep-going`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  _hcTeamRedraw();
}

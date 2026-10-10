/* ═══════════════════════════════════════════════════════
   Who is on a team (modules/teams/members.js; asked 2026-10-09: "a small section that lists the members of a team
   working within it"): one drawing for every place a team's members show — Projects → Teams here, the project chat's
   fold, the board window. All of it is the hub's reading of the board (Visibility is mechanical): a specialist's state
   point and words, its step of its budget, where it works (its own worktree's branch, or the shared folder); the
   leader; the people who started it. Built from the teams' own parts (harness-console/teams.js: _tmPt, _tmBar).
   ═══════════════════════════════════════════════════════ */

/**
 * The members of `team` (a /api/harness/missions/teams view) as rows. `open` names the global function a member's
 * conversation opens with (it gets the conversation id); `compact` draws one line per member, for a fold.
 */
function teamMembersHtml(team, { open = 'teamMemberOpen', compact = false } = {}) {
  const m = team.members || { specialists: [], people: [] };
  const link = (sid, text, title) => (sid ? `<button type="button" class="tmm-link" onclick="${open}(${jsArg(sid)})" title="${escHtml(title)}">${escHtml(text)}</button>` : escHtml(text));
  const step = s => (s.budget && (s.state === 'running' || s.state === 'paused') ? `step ${s.step} of ${s.budget}` : s.says || s.state);
  const where = s => (s.branch ? `<span class="tmm-branch" title="Its own git worktree: ${escHtml(s.root || '')}">⑂ ${escHtml(s.branch)}</span>`
    : s.root && !compact ? '<span class="tmm-where" title="Works in the project\'s folder, shared with its teammates">shared folder</span>' : '');
  const rows = (m.specialists || []).map(s => `<li class="tmm-row ${escHtml(s.state)}">
      <span class="pt ${_tmPt(s.state)}" title="${escHtml(s.state)}"></span>
      <span class="tmm-who">${link(s.sessionId, s.name, `Open ${s.name}'s conversation`)}${compact ? '' : ` <small>on</small> `}<span class="tmm-task" title="${escHtml(`Task ${s.task}: ${s.taskTitle}`)}">${compact ? ' · ' : ''}${escHtml(s.taskTitle)}</span></span>
      <span class="tmm-state">${escHtml(step(s))}${s.tries ? ` · try ${s.tries + 1}` : ''}</span>
      ${where(s)}
    </li>`).join('');
  const people = (m.people || []).map(p => escHtml(p.name)).join(', ');
  const lead = m.leader ? `<li class="tmm-row tmm-lead"><span class="pt pt-up" title="leads"></span>
      <span class="tmm-who">${link(m.leader.sessionId, m.leader.title, `Open the conversation that leads the team: the ${m.leader.kind}`)} <small>leads</small></span>
      <span class="tmm-state">${people ? `started by ${people}` : ''}</span></li>` : '';
  return `<ul class="tmm${compact ? ' compact' : ''}" aria-label="Members of the team ${escHtml(team.title)}">${lead}${rows}</ul>`;
}

/**
 * One team as a small card: its title, goal, overall bar (every task counts the same — said in its title), Board and
 * Document, then its members. `doc` names the global that opens its document (gets the team); `open` as above.
 */
function teamCardHtml(team, { open = 'teamMemberOpen', doc = 'teamDocOpen', compact = false } = {}) {
  const p = team.progress || { done: 0, total: 0, percent: 0 };
  const state = team.state === 'running' ? (team.loop?.on ? `keeps going · round ${team.loop.rounds || 0} of ${team.maxRounds}` : 'running') : team.state;
  return `<div class="tmm-card ${escHtml(team.state)}${compact ? ' compact' : ''}">
    <div class="tmm-head">
      <span class="pt ${_tmPt(team.state)}"></span><span class="tmm-title" title="${escHtml(team.goal || team.title)}">${escHtml(team.title)}</span>
      <span class="tmm-acts">
        <button class="btn btn-xs" onclick="hcTeamOpen(${jsArg(team.id)})" title="The board: every task, its contract, the notes, keep going and Stop">Board</button>
        ${team.doc?.name || team.doc?.project ? `<button class="btn btn-xs" onclick="${doc}(${jsArg(team.id)})" title="The team's document, written again at every change">Doc</button>` : ''}
      </span>
    </div>
    ${team.goal && !compact ? `<div class="desc tmm-goal">${escHtml(team.goal)}</div>` : ''}
    <div class="tmm-progress" title="Tasks done of tasks — every task counts the same">
      ${_tmBar(p.percent, team.state === 'failed' ? 'failed' : '')}<span class="tm-num">${p.done} of ${p.total} · ${p.percent}%</span><span class="tmm-state">${escHtml(state)}</span>
    </div>
    ${teamMembersHtml(team, { open, compact })}
  </div>`;
}

/** Outside Projects a member's conversation opens in the Harness console. */
function teamMemberOpen(sessionId) {
  if (typeof nav === 'function') nav('harness');
  if (typeof hcOpenSession === 'function') hcOpenSession(sessionId);
}

/** Outside Projects the document opens from its attachment copy, as a plan's does. */
function teamDocOpen(teamId) {
  const t = (typeof _hcTeams !== 'undefined' ? _hcTeams : []).concat(typeof PJTM !== 'undefined' ? PJTM.teams : []).find(x => x.id === teamId);
  if (t?.doc?.name) agentDocOpen({ name: t.doc.name, caption: `Team: ${t.title}` });
}

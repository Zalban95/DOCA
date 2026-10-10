/* ═══════════════════════════════════════════════════════
   One team's board as the page (Agents → Teams; GET /api/harness/missions/teams/:id/detail, modules/teams/detail.js):
   the plan in ordered lanes — a task's lane is how many tasks come before it, so what can run together stands side by
   side — each task with its state, step of its budget, its contract and the check's verdict, its specialist's last
   words (theirs, marked as such), its branch and a way into its conversation; then the members, the findings the
   specialists shared, the project as git and its chats say, and the team document drawn inline. All of it is the
   hub's reading of records. Built from the teams' own parts (harness-console/teams.js: _tmPt, _tmBar, _tmSay).
   ═══════════════════════════════════════════════════════ */

let _tbLast = null;   // the last detail drawn, for the switches

/** Each task's lane: 0 for a task after nothing, else one more than the furthest task it comes after. */
function _tbLanes(tasks) {
  const lane = {}, byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const of = (id, seen = new Set()) => {
    if (lane[id] != null) return lane[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const after = (byId[id]?.after || []).filter(a => byId[a]);
    return (lane[id] = after.length ? 1 + Math.max(...after.map(a => of(a, seen))) : 0);
  };
  tasks.forEach(t => of(t.id));
  const lanes = [];
  for (const t of tasks) (lanes[lane[t.id]] ||= []).push(t);
  return lanes.filter(Boolean);
}

function _tbCheck(c) {
  if (!c) return '<span class="tb-contract none">No contract — done when its specialist reports.</span>';
  const how = c.check ? Object.entries(c.check).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ') : '';
  const v = c.verdict;
  const verdict = !c.check ? '<span class="tb-verdict">on its specialist\'s word (no check)</span>'
    : v ? `<span class="tb-verdict ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓ holds' : '✗ does not hold'}${v.why ? ` — ${escHtml(v.why)}` : ''}${v.at ? ` <small>${escHtml(_tpWhen(v.at))}</small>` : ''}</span>`
    : '<span class="tb-verdict">checked when its specialist finishes</span>';
  return `<span class="tb-contract">${c.done ? `Done when ${escHtml(c.done)}` : 'Done when its check holds'}${how ? ` <code title="The check the hub runs">${escHtml(how)}</code>` : ''}</span>${verdict}`;
}

function _tbTask(x, d) {
  const team = d.team, line = d.lines[x.id], check = d.checks.find(c => c.task === x.id) || (x.contract ? { ...x.contract, verdict: null } : null);
  const member = (team.members?.specialists || []).find(s => s.task === x.id) || {};
  const label = member.name || (x.agent === 'work' ? 'Work chat' : x.agent);
  return `<article class="tb-task ${escHtml(x.state)}" aria-label="${escHtml(`Task ${x.id}: ${x.title}`)}">
    <div class="tb-head"><span class="pt ${_tmPt(x.state)}"></span><b>${escHtml(x.title)}</b><small>${escHtml(x.id)}</small></div>
    <div class="tb-who">${escHtml(label)}${x.after?.length ? ` · after ${escHtml(x.after.map(a => team.tasks.find(t => t.id === a)?.title || a).join(', '))}` : ''}</div>
    <div class="tb-prog">${_tmBar(x.percent, x.state)}<span class="tm-num">${x.state === 'running' || x.state === 'paused' ? (x.budget ? `step ${x.step} of ${x.budget}` : `${x.percent}%`) : x.state === 'done' ? '100%' : ''}</span></div>
    <div class="tb-state">${escHtml(d.says?.[x.id] || _tmSay(x, team))}${x.tries ? ` · try ${x.tries + 1}` : ''}</div>
    <div class="tb-check">${_tbCheck(check)}</div>
    ${line ? `<blockquote class="tb-line" title="${escHtml(line.kind === 'report' ? 'The first line of its report — its own words' : 'Its newest words — its own')}">${escHtml(line.text)}${line.at ? ` <small>${escHtml(_tpWhen(line.at))}</small>` : ''}</blockquote>` : ''}
    <div class="tb-foot">${member.branch ? `<span class="tmm-branch" title="Its own git worktree: ${escHtml(member.root || '')}">⑂ ${escHtml(member.branch)}</span>` : member.root ? '<span class="tmm-where">shared folder</span>' : ''}
      <span class="tb-acts">${member.sessionId ? `<button class="btn btn-xs" onclick="teamMemberOpen(${jsArg(member.sessionId)})" title="Open its conversation">Conversation</button>` : ''}
      ${x.missionId && typeof hcMissionLog === 'function' ? `<button class="btn btn-xs" onclick="hcMissionLog(${jsArg(x.missionId)})" title="Its specialist's log">Log</button>` : ''}</span></div>
  </article>`;
}

function _tbProject(p, team) {
  if (!p) return '<p class="desc">This team works on no project: its tasks work in the hub\'s workspace.</p>';
  const host = typeof authHasRight !== 'function' || authHasRight('host');
  const commits = list => (list.length ? `<ul class="tb-commits">${list.map(c => `<li><code>${escHtml(c.short)}</code> ${escHtml(c.subject)} <small>${escHtml(c.author)} · ${escHtml(_tpWhen(c.date))}</small></li>`).join('')}</ul>` : '<p class="desc">No commits yet.</p>');
  const g = p.git;
  return `<div class="tb-proj-head"><b>⟨⟩ ${escHtml(p.name)}</b> <small class="desc">${escHtml(p.root)}</small>
      ${host && typeof pjOpen === 'function' ? `<button class="btn btn-xs" onclick="nav('projects');pjOpen(${jsArg(p.id)})">Open in Projects</button>` : ''}</div>
    ${g ? `<p class="desc">On <code>${escHtml(g.branch || '?')}</code> · ${g.changed} changed file${g.changed === 1 ? '' : 's'} not committed${g.ahead ? ` · ${g.ahead} ahead` : ''}${g.behind ? ` · ${g.behind} behind` : ''}</p>` : `<p class="desc">${escHtml(p.gitError || 'Not a git repository.')}</p>`}
    <div class="tb-cols">
      <section><h4 class="tm-h">Open plan steps in its chats</h4>${p.openSteps.length ? `<ul class="tb-steps">${p.openSteps.map(s => `<li><span class="tb-step-state ${escHtml(s.state)}">${escHtml(s.state)}</span> ${escHtml(s.step)} <small>${escHtml(s.chat)} · step ${s.n}</small></li>`).join('')}</ul>` : '<p class="desc">None open.</p>'}</section>
      ${g ? `<section><h4 class="tm-h">Newest on ${escHtml(g.branch || 'its branch')}</h4>${commits(p.main)}</section>` : ''}
      ${p.branches.map(b => `<section><h4 class="tm-h">⑂ ${escHtml(b.branch)} <small>· ${escHtml(b.title)}</small></h4>${commits(b.commits)}</section>`).join('')}
    </div>
    ${p.branches.length ? '<p class="desc">Merging a task\'s branch back is yours to decide.</p>' : ''}`;
}

async function teamsBoardDraw(page, id) {
  let d;
  try { d = await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/detail`); }
  catch (e) { page.innerHTML = `${pageHeadHtml({ title: 'Teams', actions: '<button class="btn btn-sm" onclick="teamsPageList()">← All teams</button>' })}<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  if (TP.open !== id) return;
  _tbLast = d;
  const t = d.team, p = t.progress || { done: 0, total: 0, percent: 0 }, running = t.state === 'running';
  const notes = (t.notes || []).slice().reverse();
  const keepY = page.scrollTop;
  const actions = `<button class="btn btn-sm" onclick="teamsPageList()">← All teams</button>
    ${running ? `<button class="btn btn-sm btn-red" onclick="hcTeamStop(${jsArg(t.id)})" title="Running tasks stop at their next step; waiting ones never start">■ Stop the team</button>`
      : `<button class="btn btn-sm" onclick="teamsBoardArchive(${jsArg(t.id)}, ${!t.archivedAt})">${t.archivedAt ? 'Bring back' : 'Put away'}</button>`}
    <button class="btn btn-sm" onclick="teamsPageLoad()" title="Read again">↻</button>`;
  page.innerHTML = `${pageHeadHtml({ title: `Team · ${t.title}`, sub: t.goal || '', actions })}
    <div class="card tb-top">
      <div class="tm-overall" title="Tasks done of tasks — every task counts the same">
        <span class="pt ${_tmPt(t.state)}"></span>${_tmBar(p.percent, t.state === 'failed' ? 'failed' : '', true)}
        <span class="tm-num"><b>${p.percent}%</b> · ${p.done} of ${p.total} tasks done</span><span class="tm-state">${escHtml(t.state)}</span>
      </div>
      <p class="desc">Every task counts the same. A running task's bar is the steps its specialist used of its budget; it reaches 100% only when its contract holds.
        Started ${escHtml(_tpWhen(t.createdAt))}${t.endedAt ? ` · ended ${escHtml(_tpWhen(t.endedAt))}` : ''}.</p>
      <label class="tm-keep"><input type="checkbox" class="switch"${t.loop?.on ? ' checked' : ''}${t.stoppedAt ? ' disabled' : ''} onchange="hcTeamKeepGoing(${jsArg(t.id)}, this.checked)">
        Keep going — try a failed task again until every contract holds <small>(${t.loop?.rounds || 0} of ${t.maxRounds} rounds used)</small></label>
    </div>
    <h2 class="tp-h">The plan</h2>
    <div class="tb-lanes">${_tbLanes(t.tasks).map((lane, i) => `<section class="tb-lane" aria-label="Stage ${i + 1}"><div class="tb-lane-h">${i === 0 ? 'First' : `Then (${i + 1})`}${lane.length > 1 ? ' · side by side' : ''}</div>${lane.map(x => _tbTask(x, d)).join('')}</section>`).join('<div class="tb-arrow" aria-hidden="true">→</div>')}</div>
    <div class="tb-cols">
      <section class="card"><h3 class="card-title">Members</h3>${teamMembersHtml(t, { open: 'teamMemberOpen' })}</section>
      <section class="card"><h3 class="card-title">Findings shared</h3>
        ${notes.length ? `<ul class="tm-notes">${notes.map(n => `<li><small>${escHtml(_tpWhen(n.at))} · ${escHtml(n.from)} (${escHtml(n.task)})</small> ${escHtml(n.text)}</li>`).join('')}</ul>
          <p class="desc">Each is a specialist's own words, read by its teammates as information — never as instructions.</p>`
          : '<p class="desc">None yet. A specialist on the team shares what the others need with team_note.</p>'}</section>
    </div>
    <section class="card"><h3 class="card-title">The project</h3>${_tbProject(d.project, t)}</section>
    <section class="card"><h3 class="card-title">The team document</h3>
      <p class="desc">Written by the hub from the board and the reports, again at every change${t.doc?.project ? ` — also the page ${escHtml(t.doc.project)} in the project` : ''}.</p>
      <div class="tb-doc agent-doc-body" id="tb-doc"></div></section>`;
  const docEl = document.getElementById('tb-doc');
  if (docEl && typeof mdInto === 'function') mdInto(docEl, String(d.doc || '').replace(/^# .*\n+/, ''));
  else if (docEl) docEl.textContent = d.doc || '';
  page.scrollTop = keepY;
}

async function teamsBoardArchive(id, on) {
  const put = async v => { await apiFetch(`/api/harness/missions/teams/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { on: v } }); teamsPageLoad(); };
  try { await put(on); } catch (e) { return appAlert(e.message); }
  // Putting a team away is undone for a few seconds, then from the Archive (owner's rule: every delete asks or can be undone).
  if (on && typeof undoToast === 'function') undoToast('Team put away — it is in the Archive', () => put(false), { link: { label: 'Archive', onclick: () => nav('archive') } });
}

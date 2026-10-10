/* ═══════════════════════════════════════════════════════
   Agents → Teams (asked 2026-10-10: "Is there a specific place where I can see the teams of agents working, their
   plan, the state of the project?"; modules/teams). Every team this person may see — working now, then recently
   ended, then put away (by hand, or `teams.archiveAfterDays` after it ended) — each a card with its goal, its bar
   (every task counts the same), its members' states and keep-going. Opening one draws its whole board as the page
   (teams-board.js). Everything is the hub's reading of the board: no agent writes it, no model summarises it. Live on
   the feed's `teams` and `missions` topics while shown; servable alone at /?view=teams; Back on a phone closes a board.
   Harness → Teams and the missions bar's team rows open it. Its page is made here: index.html is at its line ceiling.
   ═══════════════════════════════════════════════════════ */

const TP = { teams: [], archived: null, showArchived: false, open: null, off: null, release: null, settings: {} };

function teamsTab(shown) {
  if (!shown) { TP.off?.(); TP.off = null; return; }
  if (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('teams')) return;
  if (!TP.off && typeof liveOn === 'function') {
    const again = liveDebounce(() => { if (pageShown('teams')) teamsPageLoad(); }, 700);
    const offs = [liveOn('teams', again), liveOn('missions', again), liveOn('conversation', e => { if (TP.open && ['ended', 'started', 'resync'].includes(e?.what)) again(); })];
    TP.off = () => offs.forEach(o => o());
  }
  teamsPageLoad();
}

/** Open one team's board (from anywhere: Harness → Teams, the missions bar, Projects). */
function teamsPageOpen(id) {
  TP.open = id;
  if (currentTab !== 'teams') nav('teams'); else teamsPageLoad();
  TP.release?.();
  TP.release = typeof overlayBack === 'function' ? overlayBack(() => { TP.release = null; teamsPageList(true); }) : null;
}

/** Back to every team. */
function teamsPageList(fromBack = false) {
  TP.open = null;
  if (!fromBack && TP.release) { const r = TP.release; TP.release = null; r(); }
  teamsPageLoad();
}

async function teamsPageLoad() {
  const page = document.getElementById('tab-teams');
  if (!page) return;
  if (TP.open) return teamsBoardDraw(page, TP.open);
  try {
    const r = await apiFetch('/api/harness/missions/teams');
    TP.teams = r.teams || [];
    TP.settings = { maxRounds: r.maxRounds, archiveAfterDays: r.archiveAfterDays };
    if (TP.showArchived) TP.archived = ((await apiFetch('/api/harness/missions/teams?all=1')).teams || []).filter(t => t.archivedAt);
  } catch (e) { page.innerHTML = `${_tpHead()}<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  if (TP.open) return;   // a board was opened meanwhile
  const running = TP.teams.filter(t => t.state === 'running'), ended = TP.teams.filter(t => t.state !== 'running');
  const days = TP.settings.archiveAfterDays;
  const section = (title, list, note = '') => (list.length ? `<h2 class="tp-h">${escHtml(title)} <span class="tm-num">${list.length}</span></h2>
    ${note ? `<p class="desc">${escHtml(note)}</p>` : ''}<div class="tp-grid">${list.map(_tpCard).join('')}</div>` : '');
  page.innerHTML = _tpHead()
    + (TP.teams.length || TP.archived?.length ? '' : emptyStateHtml({ title: 'No teams yet',
      text: 'When a job needs several specialists working on one plan, the Orchestrator makes a team. Ask it, for example: "Make a team to build and test the login page."' }))
    + section('Working now', running)
    + section('Recently ended', ended, days ? `Put away in the Archive ${days} day${days === 1 ? '' : 's'} after they end.` : '')
    + `<details class="tp-archived" ${TP.showArchived ? 'open' : ''} ontoggle="teamsPageArchived(this.open)"><summary>Put away${TP.archived ? ` (${TP.archived.length})` : ''}</summary>
      ${TP.showArchived ? (TP.archived?.length ? `<div class="tp-grid">${TP.archived.map(_tpCard).join('')}</div>` : '<p class="desc">Nothing put away.</p>') : ''}
      <p class="desc">Also in <a href="#" onclick="nav('archive');return false">Agents → Archive</a>, where a team comes back with one click.</p></details>`;
}

function teamsPageArchived(open) {
  if (open === TP.showArchived) return;
  TP.showArchived = open;
  teamsPageLoad();
}

function _tpHead() {
  return pageHeadHtml({ title: 'Teams', sub: 'Specialists working together on one plan: who does what, how far each is, and the project they work on.',
    actions: `<button class="btn btn-sm" onclick="teamsPageLoad()" title="Read again">↻</button>${typeof soloOpen === 'function' ? '<button class="btn btn-sm" onclick="soloOpen(\'teams\')" title="This page by itself, for a screen of its own">⧉</button>' : ''}` });
}

const _tpWhen = iso => { if (!iso) return ''; const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/** A team as a card: goal, bar, members' states, keep-going, project. The whole card opens its board. */
function _tpCard(t) {
  const p = t.progress || { done: 0, total: 0, percent: 0 };
  const keep = t.state === 'running' ? (t.loop?.on ? `keeps going · round ${t.loop.rounds || 0} of ${t.maxRounds}` : 'running') : t.state;
  const members = (t.members?.specialists || []).map(s => `<span class="tp-chip ${escHtml(s.state)}" title="${escHtml(`${s.name} on ${s.taskTitle}: ${s.says || s.state}`)}"><span class="pt ${_tmPt(s.state)}"></span>${escHtml(s.name)}${s.budget && s.state === 'running' ? ` <small>${s.step}/${s.budget}</small>` : ''}</span>`).join('');
  return `<button type="button" class="tp-card ${escHtml(t.state)}" onclick="teamsPageOpen(${jsArg(t.id)})" aria-label="${escHtml(`Team ${t.title}: ${p.done} of ${p.total} tasks done, ${keep}`)}">
    <span class="tp-card-head"><span class="pt ${_tmPt(t.state)}"></span><span class="tp-card-title">${escHtml(t.title)}</span><span class="tp-card-when">${escHtml(_tpWhen(t.endedAt || t.createdAt))}</span></span>
    ${t.goal ? `<span class="tp-card-goal">${escHtml(t.goal)}</span>` : ''}
    <span class="tmm-progress" title="Tasks done of tasks — every task counts the same">${_tmBar(p.percent, t.state === 'failed' ? 'failed' : '')}<span class="tm-num">${p.done} of ${p.total} · ${p.percent}%</span><span class="tmm-state">${escHtml(keep)}</span></span>
    <span class="tp-chips">${members}</span>
    ${t.project ? `<span class="tp-card-proj">⟨⟩ ${escHtml(t.project.name)}</span>` : ''}
  </button>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-teams' });
  page.style.overflow = 'auto';
  document.getElementById('tab-settings')?.before(page);
});

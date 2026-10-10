/* ═══════════════════════════════════════════════════════
   Projects → Teams here (asked 2026-10-09: "can teams work on the project, and can we have a small section that lists
   the members of a team working within it?"; modules/teams/place.js, members.js). Under the side view, folded when
   no team works on this project: each running team and the last few that ended, with its goal, its overall bar
   (every task counts the same), Board and its document (a page of this project), and its members — the leader, the
   people who started it, each specialist on its task with its state point, step of its budget and its worktree's
   branch. A member opens as a chat tab; the same teams show, compact, in the project chat's fold. Drawn by the shared
   parts (agent-ui/team-members.js); redrawn on the live feed's `teams` and `missions` changes.
   ═══════════════════════════════════════════════════════ */

const PJTM = { teams: [], project: null, stopLive: null };
const PJTM_RECENT = 3;   // teams that ended, kept in view below the running ones

/** The teams of the project open now: running first, then the last few that ended. */
function _pjTeamsShown() {
  const live = PJTM.teams.filter(t => t.state === 'running');
  return [...live, ...PJTM.teams.filter(t => t.state !== 'running').slice(0, PJTM_RECENT)];
}

async function pjTeamsLoad() {
  const id = PJ.project?.project.id;
  if (!id || (typeof licenceFeatureOn === 'function' && !licenceFeatureOn('teams'))) { PJTM.teams = []; return pjTeamsRender(); }
  if (PJTM.project !== id) { PJTM.project = id; PJTM.teams = []; }
  try { PJTM.teams = (await apiFetch(`/api/harness/missions/teams?project=${encodeURIComponent(id)}`)).teams || []; } catch { PJTM.teams = []; }
  if (PJTM.project !== id) return;   // another project opened meanwhile
  pjTeamsRender();
  PJC.fold?.refresh?.();
  if (!PJTM.stopLive && typeof liveOn === 'function') {
    const again = liveDebounce(() => { if (typeof pageShown === 'function' && pageShown('projects')) pjTeamsLoad(); }, 600);
    PJTM.stopLive = [liveOn('teams', again), liveOn('missions', again)];
  }
}

function pjTeamsRender() {
  const box = document.getElementById('pj-teams');
  if (!box) return;
  const shown = _pjTeamsShown();
  const running = shown.filter(t => t.state === 'running').length;
  let open = shown.length > 0;   // folded when empty; otherwise as this browser left it
  if (open) try { open = localStorage.getItem('doca.fold.pj-teams') !== '0'; } catch { /* storage off */ }
  const count = shown.length ? `${running ? `${running} working` : ''}${running && shown.length > running ? ' · ' : ''}${shown.length > running ? `${shown.length - running} ended` : ''}` : 'none';
  box.innerHTML = `<details class="pj-teams-fold"${open ? ' open' : ''}>
      <summary title="Teams of specialists working on this project, and who is on each">Teams here <span class="pj-teams-count">${escHtml(count)}</span></summary>
      <div class="pj-teams-body">${shown.map(t => teamCardHtml(t, { open: 'pjChatOpenConversation', doc: 'pjTeamDocOpen' })).join('')
        || '<p class="desc">No team works on this project yet. Ask in its chat for one — "have a team build and test it" — and its members show here.</p>'}</div>
    </details>`;
  box.querySelector('details').addEventListener('toggle', e => {
    if (!shown.length) return;
    try { localStorage.setItem('doca.fold.pj-teams', e.target.open ? '1' : '0'); } catch { /* storage off */ }
  });
}

/** The running teams of this project, for the chat's fold (agent-ui/side-fold.js). */
function pjTeamsRunning() { return PJTM.teams.filter(t => t.state === 'running'); }

/** A team's document: the page in this project when it is one, else its attachment copy. */
function pjTeamDocOpen(teamId) {
  const t = PJTM.teams.find(x => x.id === teamId);
  if (t?.doc?.project && t.project?.id === PJ.project?.project.id) return pjOpenFile(pjAbs(t.doc.project));
  return teamDocOpen(teamId);
}

/** A member's conversation as a chat tab of this project (its missions are its conversations); else in the Harness. */
async function pjChatOpenConversation(sessionId) {
  const pane = document.getElementById('pj-chat');
  if (pane && !pane.classList.contains('open')) {
    pane.classList.add('open');
    document.getElementById('pj-chat-toggle')?.classList.add('btn-teal');
    await pjChatLoad();
  }
  await pjTabsSync({ quiet: true });
  if (!PJC.chats.some(c => c.id === sessionId)) return teamMemberOpen(sessionId);
  PJC.seen.add(sessionId);
  if (!PJC.open.includes(sessionId)) PJC.open.push(sessionId);
  await pjChatActivate(sessionId);
  _pjTabsSave();
}

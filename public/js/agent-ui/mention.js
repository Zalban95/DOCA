/* ═══════════════════════════════════════════════════════
   What a turn made — a work chat, a team, a specialist's mission — as a chip
   in the transcript that opens it (asked 2026-10-14: "have these chats
   mentioned when created so we can follow the mention as a link … to their
   team or chat", like a subagent's row in Cursor or Claude).

   The hub keeps the chip on the tool's row (`mentions`, modules/harness/
   mentions.js) and says it as a `mention` event, so a turn watched and a
   transcript reloaded draw the same thing. Every chat draws it with
   agentMentionAppend; its point follows the live feed (missions, teams, a
   conversation starting or ending) while it is on the page.
   ═══════════════════════════════════════════════════════ */

const AGENT_MENTION_KIND = { work: 'Work chat', team: 'Team', mission: 'Specialist' };

/** A state as the point's class: running breathes, done is green, failed red, the rest still. */
function _mentionPt(state) {
  const s = String(state || '');
  if (['running', 'working', 'queued', 'waiting'].includes(s)) return 'pt pt-up pt-run';
  if (['done', 'idle'].includes(s)) return 'pt pt-done';
  if (['failed', 'error', 'blocked'].includes(s)) return 'pt pt-err';
  if (['question', 'asking', 'paused'].includes(s)) return 'pt pt-ask';
  return 'pt pt-stopped';
}

/** The chip for one mention `{kind, id, sessionId?, title, state, projectId?}`. */
function agentMentionEl(m) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'agent-mention';
  b.dataset.kind = m.kind;
  b.dataset.id = m.id;
  if (m.sessionId) b.dataset.session = m.sessionId;
  const pt = document.createElement('span');
  pt.className = _mentionPt(m.state);
  pt.title = String(m.state || '');
  const kind = document.createElement('span');
  kind.className = 'agent-mention-kind';
  kind.textContent = AGENT_MENTION_KIND[m.kind] || 'Made';
  const title = document.createElement('span');
  title.className = 'agent-mention-title';
  title.textContent = m.title || m.id;
  b.append(pt, kind, title);
  b.title = `Open ${(AGENT_MENTION_KIND[m.kind] || 'it').toLowerCase()} “${m.title || m.id}”`;
  b.onclick = () => agentMentionOpen(m);
  _mentionWatch();
  return b;
}

/** Into a transcript: out of the turn's open working block (as a picture is), then scrolled to. */
function agentMentionAppend(box, m, scroll) {
  if (!box || !m?.id) return null;
  box.querySelector(':scope > .placeholder')?.remove();
  if (typeof agentWorkingGiveBack === 'function') agentWorkingGiveBack(box);
  const el = agentMentionEl(m);
  box.appendChild(el);
  scroll?.();
  return el;
}

/** Open what a chip names: a work chat as a chat tab (Projects) or in the Harness, a team's board, a mission's log. */
function agentMentionOpen(m) {
  if (m.kind === 'team') return typeof teamsPageOpen === 'function' ? teamsPageOpen(m.id) : null;
  if (m.kind === 'mission' && typeof hcMissionLog === 'function' && document.getElementById('hc-mission-overlay')) return hcMissionLog(m.id);
  const sid = m.sessionId || (m.kind === 'work' ? m.id : null);
  if (!sid) return null;
  if (typeof currentTab !== 'undefined' && currentTab === 'projects' && typeof pjChatOpenConversation === 'function'
    && (!m.projectId || (typeof PJ !== 'undefined' && PJ.project?.project?.id === m.projectId))) return pjChatOpenConversation(sid);
  if (typeof teamMemberOpen === 'function') return teamMemberOpen(sid);
  return null;
}

/** A chip's point follows its record while it is on the page: the live feed says what changed, and its new state. */
function agentMentionState(kind, id, state) {
  for (const el of document.querySelectorAll(`.agent-mention[data-kind="${CSS.escape(kind)}"]`)) {
    if (el.dataset.id !== id && el.dataset.session !== id) continue;
    const pt = el.querySelector('.pt');
    if (pt) { pt.className = _mentionPt(state); pt.title = state; }
  }
}

let _mentionHeard = false;
function _mentionWatch() {
  if (_mentionHeard || typeof liveOn !== 'function') return;
  _mentionHeard = true;
  liveOn('missions', e => { if (e?.id && e.what && e.what !== 'resync') agentMentionState('mission', e.id, e.what); });
  liveOn('teams', e => { if (e?.id && e.what && !['resync', 'archived', 'recalled'].includes(e.what)) agentMentionState('team', e.id, e.what); });
  liveOn('conversation', e => {
    if (!e?.id || !['started', 'ended'].includes(e.what)) return;
    agentMentionState('work', e.id, e.what === 'started' ? 'running' : 'idle');
  });
}

'use strict';

/**
 * What a conversation made, as a chip in its own transcript (asked 2026-10-14: "have these chats mentioned when
 * created so we can follow the mention as a link … to their team or chat", like a subagent's row in Cursor or
 * Claude). A tool that creates calls `ctx.mention(row)`; the turn says it as a `mention` event and keeps it on the
 * tool's row (`mentions`, as `images` are kept — turn/tool-calls.js), so a reloaded transcript draws the same chip.
 * The panel draws and opens it (public/js/agent-ui/mention.js); the model reads only the tool's result.
 *
 *   { kind: 'work' | 'team' | 'mission', id, sessionId?, title, state, projectId? }
 *
 * Names and states only, from the records themselves — never an errand's text beyond its title.
 */
const short = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function projectOf(sessionId) {
  try { return require('../projects/store').forSession(sessionId)?.id || null; } catch { return null; }
}

/** A work chat, by its conversation id. */
function work(id) {
  const s = require('./organization').session(id);
  return { kind: 'work', id: s.id, sessionId: s.id, title: short(s.title, 100) || 'Work chat', state: s.state || 'idle', projectId: projectOf(s.id) };
}

/** A team, as teams/ keeps it. */
function team(t) {
  return { kind: 'team', id: t.id, title: short(t.title, 100) || 'Team', state: t.state || 'running', projectId: t.projectId || null };
}

/** A specialist's mission, as agents/missions.js keeps it. */
function mission(m) {
  return { kind: 'mission', id: m.id, sessionId: m.sessionId || null, title: short(`${m.label || m.agentId}: ${m.task || ''}`, 100),
    state: m.state || 'running', projectId: m.sessionId ? projectOf(m.sessionId) : null };
}

module.exports = { work, team, mission };

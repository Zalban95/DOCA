'use strict';

/**
 * A call's turn answers at once (asked 2026-10-07 from the watch: "the response can be immediate, so no thinking …
 * if you ask it to focus or think harder or take its time, it can start thinking and delegate as the orchestrator
 * normally does"). Two speeds, one conversation, built from what a turn already has rather than a second agent:
 *
 *   - **The front.** A spoken turn (assistant mode, or a call when `assistant.calls` says so — effort.spokenProfile)
 *     holds a short kit: answer, and the quick actions (a reminder, memory, a device, a screen, a recipe, the day, a
 *     setting asked for, the MCP servers' tools — the home is one), plus the ways to hand work on. It is not triaged
 *     (that can cost a model call before the first word), it thinks at assistant mode's effort (`assistant.effort`,
 *     low by default: no thinking on providers that switch it), on assistant mode's quick model where one is set, and
 *     after `WORK_STEPS` steps of real work the rest moves to a work chat (handoff.js) with a spoken line.
 *   - **Anything bigger** — a request the triage's rules call large, or one where the person asks to think harder,
 *     take their time or focus — goes to a work chat at once, before any model is asked, with the conversation's last
 *     words for context and, when asked to think, effort `high` on that chat. The call says one line and stays free;
 *     what the work chat reports is said in the call while it is open (realtime/calls.js).
 *
 * A separate model reading the call for actions was the other way to do it; it would add a second model's latency to
 * every request and a second place that decides what the person meant, so this is the turn's own shape instead.
 * `assistant.front` (default on) switches it off: a spoken turn then holds what any turn holds, as before 2.304.0.
 */
const FRONT = new Set(['remind', 'today', 'memory_write', 'memory_search', 'memory_list', 'recall_conversations', 'tell_device',
  'screen', 'recipe', 'skill', 'effort', 'settings_read', 'settings_propose', 'system_status', 'doca_clients', 'show_media', 'web_search',
  'work_chats', 'agent_dispatch', 'agent_results']);
const STEPS = 6;        // tool steps a front turn may take at most
const WORK_STEPS = 2;   // steps of real work before the rest moves to a work chat

// "Think harder", "take your time", "focus" — and the Italian the owner speaks to it.
const DEEP = /\b(think (it )?(harder|hard|deeper|carefully|it through|this through)|take (your|all the|the) time|take your time|focus on (this|it|that)|really focus|in depth|thoroughly|dig (into|deeper)|pensa(ci)? (bene|meglio|di più|a fondo)|prenditi (il|tutto il) tempo|con calma|concentrati|approfondisci|ragionaci)\b/i;

const schema = () => require('../../settings-schema');
const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * This turn's shape, or null when it is not a front turn: { delegate, deep, why } for one that goes to a work chat at
 * once, else { steps, workSteps, off(disabled) } — `off` adds every tool outside the kit to the turn's disabled list.
 */
function plan({ client, message, session, profile }) {
  if (schema().value('assistant.front') === false) return null;
  if (!require('./effort').spokenProfile(client)) return null;
  if (profile && profile.level !== 'orchestrator') return null;   // a specialist is never on a call
  const text = String(message || '');
  const deep = DEEP.test(text);
  const rest = text.replace(DEEP, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (deep && rest.length >= 3) return { delegate: true, deep: true, why: `asked to "${text.match(DEEP)[0].toLowerCase()}"` };
  const rated = require('./triage').rate({ message: text, session });   // its size; a call's own lean is towards quick, not small
  if (rated.difficulty === 'large') return { delegate: true, deep: false, why: `a large request (${rated.reasons.join(', ')})` };
  return { delegate: false, steps: STEPS, workSteps: WORK_STEPS, off: disabled => offOutside(disabled) };
}

/** The disabled list with every tool outside the front's kit added: the built-ins named above and MCP servers' tools. */
function offOutside(disabled) {
  const kits = require('../kits');
  const names = require('../tools').describe().map(t => t.name);
  const held = n => FRONT.has(n) || (kits.kitOf(n) === 'mcp');
  return [...new Set([...disabled, ...names.filter(n => !held(n))])];
}

/** The conversation's last few spoken lines, so the work chat knows what "that" is. */
function lately(sessionId) {
  const rows = require('../memory').messages(sessionId).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  return rows.slice(-7, -1).map(m => `${m.role === 'user' ? 'Person' : 'DOCA'}: ${short(m.content, 300)}`).join('\n');
}

/**
 * Hand the request to a work chat now, before any model is asked. @returns {string} the line the call says
 */
function delegate({ session, message, client, say, deep }) {
  const organization = require('../organization'), memory = require('../memory');
  const chat = organization.create({ title: short(message, 80) || 'From a call' });
  require('../session-access').claim(client?.user, chat.id);   // the person's work, under their level
  if (deep) memory.updateSession(chat.id, { effort: 'high' });   // effort.js: this conversation's own level
  const before = lately(session.id);
  const task = 'The person asked this in a live spoken call, and is waiting to hear back while they carry on talking. '
    + `Their request:\n${message}\n\n${before ? `What was said just before (most recent last):\n${before}\n\n` : ''}`
    + (deep ? 'They asked you to take your time and think it through: do, and check before you conclude.\n\n' : '')
    + 'Carry it to the end and report with work_chats. Keep the report short: it is read out to them.';
  organization.start(chat.id, task, session.id);
  say({ type: 'handoff', step: 0, sessionId: chat.id, title: chat.title, from: session.id });
  const line = deep ? 'I will take my time on that, and tell you when it is done.' : 'On it. I will tell you when it is done.';
  memory.append(session.id, { role: 'assistant', content: line });
  say({ type: 'text', text: line });
  return line;
}

/** The prompt's line for a front turn (turn/client.js), so the agent knows its kit is short on purpose. */
const LINE = 'You are the quick voice of this call: answer at once, or do one short action. Anything that needs more than a '
  + 'couple of steps goes to a work chat (work_chats) or a specialist, with one spoken line that you are on it — its outcome '
  + 'is said in this call when it ends.';

module.exports = { plan, delegate, offOutside, DEEP, FRONT, STEPS, WORK_STEPS, LINE };

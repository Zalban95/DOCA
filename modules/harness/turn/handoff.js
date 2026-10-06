'use strict';

/**
 * The Orchestrator stays free for the person, by code (decided with the owner
 * 2026-10-04: "a few work steps, then the rest to a work chat"). Its prompt
 * has long said to hand long jobs to a work chat, and twice in the record it
 * did a 10–28-step job in its own turn while the person waited; a rule the
 * model applies by judgement is a rule it can misjudge.
 *
 * So: once its own turn has spent `orchestratorWorkSteps` steps on real work
 * (anything the approval gate would ask about — shell, writing files, an MCP
 * tool, the web — and not reading, its memory, or coordinating), the next step
 * that wants more work does not run. The job moves to a new work chat with the
 * request, what was done and what was about to happen, the Orchestrator says
 * so in one line, and its turn ends. 0 switches it off.
 */
const memory = require('../memory');

// Coordinating and remembering: the Orchestrator's own job, never "work".
const COORD = new Set(['work_chats', 'work_plan', 'agent_dispatch', 'agent_results', 'agent_resume', 'permission_grant',
  'settings_propose', 'install_propose', 'memory_write', 'memory_rules_write', 'memory_flag', 'memory_forget',
  'ask_device', 'tell_device', 'skill', 'show_media', 'show_image']);

function argsOf(tc) { try { return tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { return {}; } }

function isWork(tc) {
  const name = tc.function?.name || '';
  if (COORD.has(name) || require('../approval').FREE.has(name)) return false;
  return !require('../tools').isRead(name, argsOf(tc));
}

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const callLine = tc => `${tc.function?.name}(${short(tc.function?.arguments, 160)})`;

/** What the turn has done since its request: each call and the head of its result. */
function doneSince(sessionId, from) {
  const rows = memory.messages(sessionId).slice(from);
  const out = [];
  for (const r of rows) {
    if (r.role === 'assistant' && r.tool_calls) for (const tc of r.tool_calls) out.push(`- ${callLine(tc)}`);
    if (r.role === 'tool') out.push(`  → ${short(r.content, 240)}`);
  }
  return out.join('\n') || '- nothing yet';
}

/**
 * Move the job to a work chat. `reply` is the assistant row just stored, whose
 * calls have not run: each gets its result row, so no call is left unpaired.
 * @returns {string} the line the Orchestrator ends its turn with
 */
function handOff({ session, message, from, reply, say, step }) {
  const organization = require('../organization');
  const chat = organization.create({ title: short(message, 80) || 'Handed-off job' });
  for (const tc of reply.tool_calls) {
    const name = tc.function?.name || '';
    const result = `Not run here: the job moved to the work chat "${chat.title}" (${chat.id}), which carries it on.`;
    memory.append(session.id, { role: 'tool', tool_call_id: tc.id || name, name, content: result });
    say({ type: 'tool_result', name, result, step });
  }
  const task = 'The Orchestrator started this job and handed it to you so it stays free for the person. Their request:\n'
    + `${message}\n\nWhat was already done (results shortened):\n${doneSince(session.id, from)}\n\n`
    + `It was about to: ${reply.tool_calls.map(callLine).join('; ')}\n\n`
    + 'Check what was done rather than trusting the summary, carry the job to the end, and report with work_chats.';
  organization.start(chat.id, task, session.id);
  say({ type: 'handoff', step, sessionId: chat.id, title: chat.title });
  return `This is turning into a longer job, so it carries on in the work chat **${chat.title}** — I'm free in the meantime, `
    + 'and I will tell you when it reports.';
}

module.exports = { isWork, handOff, doneSince, COORD };

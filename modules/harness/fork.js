'use strict';

/**
 * A job leaves the main chat for a work chat of its own, carrying what it needs (experiment alwaysFree,
 * docs/experiments/always-free.md; the design "Always free" §3.3). Built without a model call:
 *
 *   - the request, word for word, with the files the person sent with it (the old hand-offs sent text only, so a
 *     screenshot sent with "fix this" was lost — design §6.2);
 *   - the conversation's last lines and its summary of what came earlier (capped), so the worker knows what "that" is;
 *   - the project the conversation works in (the old hand-offs set none);
 *   - what the main chat already did this turn, when the safety net moved it (turn/handoff.js);
 *   - a seed plan of one step — the request — that the worker refines (harness/living-plan.js), and that the person
 *     can add to through the main chat while it runs;
 *   - the person (session-access.claim) and where it came from (`job.origin`).
 *
 * The words the main chat says are fixed templates naming the job (the product's name from branding.js), so the
 * acknowledgement costs no model step. Without the flag the old bodies run (handoff.handOff, front.delegate; W14).
 */
const memory = require('./memory');

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const product = () => require('../branding').name('product');
const SUMMARY_MAX = 1500;

/** The job's name: the request's first sentence, a few words — what the main chat and the panel call it. */
function titleOf(message) {
  const first = String(message || '').split(/\n|(?<=[.!?])\s/)[0].replace(/^\s*(please|pls|can you|could you|would you)\b[\s,]*/i, '');
  const t = short(first, 60).replace(/[?.!,;:]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Background job';
}

/** The conversation's last person/assistant lines before this request (most recent last). */
function lately(sessionId, n = 8) {
  const rows = memory.messages(sessionId).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  return rows.slice(-(n + 1), -1).map(m => `${m.role === 'user' ? 'Person' : product()}: ${short(m.content, 300)}`).join('\n');
}

const names = list => (list || []).map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean);

/** The task the worker starts with. */
function taskFor({ session, message, deep, spoken, done, attachments }) {
  const before = lately(session.id), summary = short(memory.getSession(session.id)?.summary, SUMMARY_MAX);
  return [`The person asked this in the main conversation, and it was handed to you before any work was done there, so the main chat stays free for them. Their request:\n${message}`,
    attachments.length ? `The files they sent with it are attached here: ${attachments.join(', ')}.` : '',
    before ? `What was said just before (most recent last):\n${before}` : '',
    summary ? `What that conversation decided earlier (its summary):\n${summary}` : '',
    done ? `What the main chat already did this turn (results shortened):\n${done.lines}\n\nIt was about to: ${done.next}\n\nCheck what was done rather than trusting the summary.` : '',
    deep ? 'They asked you to take your time and think it through: do, and check before you conclude.' : '',
    'Your plan starts with one step, the request itself. Refine it as you go — work_plan add for each step you see (with a contract where a check fits), '
      + 'progress as you work; not draft, which would reset it. While you work the person may add a step or cancel one through the main chat: it reaches you '
      + 'before your next step as a message starting "[plan]", and is in your plan flagged as theirs. Carry it to the end and report with work_chats.'
      + (spoken ? ' Keep the report short: it is read out to them.' : ''),
  ].filter(Boolean).join('\n\n');
}

/**
 * Make the work chat and start it (or line it up, when the person's jobs are at work.parallel — work-cap.js).
 * @returns {{ chat, title, waiting: boolean }}
 */
function make({ session, message, person = null, deep = false, spoken = false, attachments = [], done = null, title = null }) {
  const organization = require('./organization');
  const name = title || titleOf(message);
  let projectId = null;
  try { projectId = require('../projects/store').forSession(session.id)?.id || null; } catch { /* no project */ }
  const chat = organization.create({ title: name, fields: projectId ? { projectId } : null });
  require('./session-access').claim(person, chat.id);   // the person's work, under their level — not the Orchestrator's owner's
  if (deep) memory.updateSession(chat.id, { effort: 'high' });   // effort.js: this conversation's own level
  require('./living-plan').seed(chat.id, { title: name, request: message, by: person });
  const files = names(attachments);
  const task = taskFor({ session, message, deep, spoken, done, attachments: files });
  const origin = { sessionId: session.id, by: person?.id || null, at: new Date().toISOString() };
  const waiting = require('./work-cap').lineUp(chat.id, { person, task, from: session.id, attachments: files, origin });
  if (!waiting) organization.start(chat.id, task, session.id, { attachments: files, origin, asker: person });   // their own words: their authority (askedBy)
  return { chat: organization.session(chat.id), title: name, waiting };
}

/** The fixed line the main chat says, by how it was asked and whether the job waits for a free place. */
function line({ title, spoken, deep, safety, waiting }) {
  if (waiting) return spoken ? `${title} is lined up: it starts when one of your other jobs ends.`
    : `**${title}** is lined up behind your other background jobs (work.parallel, Settings → Developer) — it starts when one ends, and ${product()} tells you here when it reports.`;
  if (spoken) return deep ? `I'll take my time on ${title} in the background, and tell you when it's done.`
    : `Checking that now — ${title} is running in the background. I'll tell you when it's done.`;
  if (safety) return `That needs real work, so **${title}** carries on in the background, in a work chat of its own. I'm free meanwhile; ${product()} tells you here when it reports.`;
  return deep ? `I'll take my time on **${title}** in the background, in a work chat of its own. Ask me anything meanwhile; ${product()} tells you here when it reports.`
    : `On it — **${title}** is running in the background, in a work chat of its own. Ask me anything meanwhile; ${product()} tells you here when it reports.`;
}

/** Before any model is asked (turn/route.js): the line is said and kept as the turn's answer. @returns {string} */
function beforeModel({ session, message, client, say, deep, attachments }) {
  const spoken = client?.mode === 'assistant' || client?.mode === 'call';
  const { chat, title, waiting } = make({ session, message, person: client?.user, deep, spoken, attachments });
  say({ type: 'handoff', step: 0, sessionId: chat.id, title: chat.title, from: session.id, before: true, ...(waiting ? { waiting } : {}) });
  const text = line({ title, spoken, deep, waiting }) + require('./manual-note').note(session.id, { spoken });   // Manual: the price, and Auto offered
  memory.append(session.id, { role: 'assistant', content: text });
  say({ type: 'text', text });
  return text;
}

/**
 * The safety net (turn/handoff.step): the main chat's model chose work. Its calls do not run here — each gets its
 * result row, so none is left unpaired — and what it read this turn travels with the job. @returns {string} the line
 */
function fromSafetyNet({ session, message, from, reply, say, step, person, spoken, attachments }) {
  const handoff = require('./turn/handoff');
  const done = { lines: handoff.doneSince(session.id, from), next: reply.tool_calls.map(handoff.callLine).join('; ') };
  const { chat, title, waiting } = make({ session, message, person, spoken, attachments, done });
  const mention = require('./mentions').work(chat.id);   // the first row carries a chip that opens it (mentions.js)
  reply.tool_calls.forEach((tc, i) => {
    const name = tc.function?.name || '';
    const result = `Not run here: the job moved to the work chat "${chat.title}" (${chat.id}), which carries it on.`;
    if (!i) say({ type: 'mention', mention, step });
    memory.append(session.id, { role: 'tool', tool_call_id: tc.id || name, name, content: result, ...(i ? {} : { mentions: [mention] }) });
    say({ type: 'tool_result', name, result, step });
  });
  say({ type: 'handoff', step, sessionId: chat.id, title: chat.title, from: session.id, ...(waiting ? { waiting } : {}) });
  return line({ title, spoken, safety: true, waiting }) + require('./manual-note').note(session.id, { spoken });
}

module.exports = { make, line, beforeModel, fromSafetyNet, titleOf, lately, taskFor };

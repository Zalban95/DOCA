'use strict';

/**
 * The learning loop (TODO H10.3; OpenDots' "automatic learning"): a conversation that got something done becomes
 * a skill — the *when* and *why*, as Agent Skills instructions — drafted by a model and saved only after a person
 * has read and edited it. (Its *exactly how* is a recipe: "＋ last turn".)
 *
 * The draft is one agent.ask: no tools, no memory, no charter around it — the transcript is data to summarise, and
 * the reply is a draft, never an instruction anyone follows until the person saves it.
 */
const PROMPT = [
  'You turn a conversation in which an AI agent got a task done into a reusable skill in the Agent Skills format.',
  'Write what a capable agent needs to do this kind of task again, faster and without the dead ends:',
  'when to use it, the steps that worked, the exact commands or tool calls where they matter, the pitfalls found and',
  'how to check the result. Leave out the failed attempts except as a pitfall, and anything specific to this one',
  'occasion (names, paths, values) unless it is the point — write those as placeholders.',
  'Reply with JSON only: {"name": "kebab-case-name", "description": "one line: when to use it", "body": "markdown instructions"}.',
].join(' ');

/** The conversation as text a model can read: who asked what, which tools ran with which arguments, how they ended. */
function transcriptOf(sessionId, max = 24000) {
  const rows = require('./memory').messages(sessionId);
  const out = [];
  for (const r of rows) {
    if (r.role === 'user') out.push(`USER: ${String(r.content || '').slice(0, 2000)}`);
    else if (r.role === 'assistant') {
      if (r.content) out.push(`AGENT: ${String(r.content).slice(0, 2000)}`);
      for (const tc of r.tool_calls || []) out.push(`TOOL CALL ${tc.function?.name}: ${String(tc.function?.arguments || '').slice(0, 600)}`);
    } else if (r.role === 'tool') out.push(`RESULT ${r.name}: ${String(r.content || '').slice(0, 500)}`);
  }
  const text = out.join('\n');
  return text.length > max ? `…(earlier part left out)\n${text.slice(-max)}` : text;
}

/** A draft skill from this conversation; nothing is written. */
async function draftSkill(sessionId, { signal } = {}) {
  const transcript = transcriptOf(sessionId);
  if (!transcript.trim()) throw Object.assign(new Error('That conversation is empty.'), { status: 400 });
  const reply = await require('./turn/transport').ask({ system: PROMPT, user: transcript, temperature: 0.2, signal });
  const json = (/\{[\s\S]*\}/.exec(reply) || [])[0];
  let d;
  try { d = JSON.parse(json); } catch { throw Object.assign(new Error('The model did not answer with a skill (JSON). Try again, or write it by hand.'), { status: 502 }); }
  const name = String(d.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'new-skill';
  return { name, description: String(d.description || '').slice(0, 300), body: String(d.body || '').slice(0, 40000), from: { sessionId } };
}

module.exports = { draftSkill, transcriptOf, PROMPT };

'use strict';

/**
 * The learning loop (the owner, 2026-10-17: "after the first time they learn to do something they can create it [the
 * skill]"; Hermes Agent's background review). When a work chat's job ends done after real work — many tool calls,
 * setbacks it got past, or a person's correction on the way — its record is read once in the background by the
 * harness's model with no tools (`agent.ask`, like the rules review): it answers NONE when the work was routine or a
 * skill it read already covers it, or writes a skill — lessons, not a log: when to use it, the steps, each pitfall with
 * why, how to check it is done. Kept as a skill on this machine (skills.write: the name checked, never over one that
 * exists, a key refused), an activity line and a notice to the job's person, who removes it in Settings → Harness →
 * Skills like any. A job that wrote a skill itself is not read again. Switch: `skillSuggest.learn` (on; the owner's).
 */
const MIN_CALLS = 20, MIN_SETBACKS = 2, MAX_LINES = 140;

const PROMPT = `You keep a team's know-how. Below is how one piece of work went. If it shows a way of working that will
help the next time a similar task comes — steps that worked, a dead end and the way around it, a correction the person
made — write it as a skill: lessons, not a log. Answer exactly NONE when the work was routine, or when a skill it read
already covers it. Otherwise answer only the skill's file:

---
name: <lower-case words joined by -, naming the kind of task, never this project or a person>
description: <one line starting with a verb: when to use it>
---
# <Title>
<When to use it, in a sentence.>
## Steps
<numbered, each a thing to do>
## Pitfalls
<each a general rule plus, in one clause, why>
## Done when
<how to check it worked>

Never include private data: no names of people, no paths of this machine, no keys, no project names. At most 60 lines.`;

const argsOf = c => { try { return JSON.parse(c.function?.arguments || '{}') || {}; } catch { return {}; } };
const short = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const isDoca = r => r.from?.formFactor === 'hub' || ['DOCA', 'Panel'].includes(r.from?.name) || /^\[(panel|DOCA)\]/.test(String(r.content || ''));

/** What the record says: calls, setbacks and how each was followed, skills read and written, corrections. */
function digest(rows) {
  const calls = [], setbacks = [], read = new Set();
  let wrote = false, corrected = false, firstUser = null;
  const byId = new Map();
  for (const r of rows) {
    if (r.role === 'user' && !isDoca(r)) { if (firstUser == null) firstUser = short(r.content, 1500); else corrected = true; }
    if (r.role === 'assistant') for (const c of r.tool_calls || []) {
      const name = c.function?.name, a = argsOf(c);
      byId.set(c.id, name);
      if (name === 'skill' && a.action === 'read') read.add(a.name);
      if (name === 'skill' && ['write', 'get'].includes(a.action)) wrote = true;
      calls.push(`${name} ${short(a.command || a.path || a.action || a.query || JSON.stringify(a), 120)}`);
    }
    if (r.role === 'tool' && /^(Error|exit [1-9]|Not run|Refused|Denied)/.test(String(r.content || '').trim()))
      setbacks.push(`${byId.get(r.tool_call_id) || 'a call'} → ${short(r.content, 200)}`);
  }
  return { calls, setbacks, read: [...read], wrote, corrected, request: firstUser };
}

/** organization.js, on a work chat's final report: learning starts in the background when the job is done. */
function on(sessionId, outcome, result) {
  if (outcome === 'done') setImmediate(() => learn(sessionId).catch(e => console.warn(`[learn] ${sessionId}: ${e.message}`)));
  return result;
}

/** Read one finished job; resolves the skill written, or null with why. */
async function learn(sessionId, { ask = null } = {}) {
  if (!require('../settings-schema').value('skillSuggest.learn')) return { skill: null, why: 'switched off' };
  const memory = require('./memory');
  const s = memory.getSession(sessionId);
  if (!s) return { skill: null, why: 'no such conversation' };
  const d = digest(memory.messages(sessionId));
  if (d.wrote) return { skill: null, why: 'it kept a skill itself' };
  if (d.calls.length < MIN_CALLS && d.setbacks.length < MIN_SETBACKS && !d.corrected) return { skill: null, why: 'routine work' };
  const record = [`## The request\n${d.request || s.title}`, s.plan?.steps?.length ? `## Its plan\n${s.plan.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '',
    `## What it did, in order\n${d.calls.slice(0, MAX_LINES).join('\n')}${d.calls.length > MAX_LINES ? `\n… and ${d.calls.length - MAX_LINES} more` : ''}`,
    d.setbacks.length ? `## Setbacks\n${d.setbacks.slice(0, 30).join('\n')}` : '', d.corrected ? '## The person corrected it along the way' : '',
    d.read.length ? `## Skills it read\n${d.read.join(', ')}` : '', `## Its final report\n${short(s.brief || '', 3000)}`].filter(Boolean).join('\n\n');
  const person = (() => { try { const id = require('./session-access').ownerOf(sessionId); return id ? { id } : null; } catch { return null; } })();
  const text = String(await (ask || require('./agent').ask)({ system: PROMPT, user: record, person }) || '').trim();
  if (/^NONE\b/i.test(text)) return { skill: null, why: 'the model found nothing new to keep' };
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]+)$/.exec(text.replace(/^```\w*\n|\n```$/g, ''));
  const name = /^name:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m.exec(m?.[1] || '')?.[1], description = /^description:\s*(.+)$/m.exec(m?.[1] || '')?.[1];
  if (!m || !name || !description) return { skill: null, why: 'what came back was not a skill' };
  const skills = require('./skills');
  if (skills.list().some(x => x.name === name)) return { skill: null, why: `a skill called ${name} exists already` };
  skills.write(name, { description, body: `${m[2].trim()}\n\n<!-- learned ${new Date().toISOString().slice(0, 10)} from the work chat "${short(s.title, 80)}" (${sessionId}) -->` });
  require('../activity').note({ from: 'skills', sessionId, what: `learned the skill ${name} from "${short(s.title, 80)}"`, why: 'its job ended done after real work (the learning loop, skillSuggest.learn)' });
  try { require('../notices').post({ personId: person?.id || null, title: `Learned a skill: ${name}`, text: `${description}\nFrom the work chat "${short(s.title, 80)}". It is in Settings → Harness → Skills — remove it there if it is wrong.`, from: 'skills' }); } catch { /* no notices */ }
  return { skill: name, why: 'kept' };
}

module.exports = { on, learn, digest, MIN_CALLS };

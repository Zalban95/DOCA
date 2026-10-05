'use strict';

/**
 * Whether one case's outcome passes its checks (TODO H10.1). An outcome is what the turn did, read from its run and
 * trace — `{ text, tools: [names in order], steps, tokens, ms, state, error }` — and each check is one line a person
 * can read:
 *
 *   { contains: 'x' } / { notContains: 'x' }   in the answer, ignoring case
 *   { matches: 'regex' }                        the answer, case-insensitive
 *   { tool: 'name' } / { noTool: 'name' }       called, or never called (a tool name or an mcp__server__ prefix)
 *   { maxSteps: n } / { maxTokens: n }          what the turn took
 *   { judge: 'rubric' }                         one model call with no tools judges the answer against the rubric
 *
 * The judge is the harness's own `ask` (no tools, no memory, no charter): it reads the question, the rubric and the
 * answer, and its first word is PASS or FAIL. It is the only check that spends tokens.
 */
const named = (tools, name) => tools.some(t => t === name || (name.endsWith('__') && t.startsWith(name)));

async function judge(rubric, prompt, outcome) {
  const reply = await require('../harness/agent').ask({
    system: 'You grade an AI assistant\'s answer against a rubric. Reply with PASS or FAIL as the first word, then one short sentence saying why. Judge only what the rubric asks.',
    user: `Question:\n${prompt}\n\nRubric:\n${rubric}\n\nAnswer:\n${String(outcome.text || '').slice(0, 6000)}`,
  });
  return { pass: /^\W*pass\b/i.test(reply), why: reply.replace(/^\W*(pass|fail)\b[:.\s-]*/i, '').slice(0, 300) };
}

async function one(c, prompt, o) {
  const text = String(o.text || '');
  if (c.contains !== undefined) return { pass: text.toLowerCase().includes(String(c.contains).toLowerCase()), why: `answer contains "${c.contains}"` };
  if (c.notContains !== undefined) return { pass: !text.toLowerCase().includes(String(c.notContains).toLowerCase()), why: `answer does not contain "${c.notContains}"` };
  if (c.matches !== undefined) {
    try { return { pass: new RegExp(c.matches, 'i').test(text), why: `answer matches /${c.matches}/` }; }
    catch (e) { return { pass: false, why: `bad pattern: ${e.message}` }; }
  }
  if (c.tool !== undefined) return { pass: named(o.tools, c.tool), why: `called ${c.tool}` };
  if (c.noTool !== undefined) return { pass: !named(o.tools, c.noTool), why: `never called ${c.noTool}` };
  if (c.maxSteps !== undefined) return { pass: (o.steps ?? Infinity) <= c.maxSteps, why: `${o.steps ?? '?'} steps ≤ ${c.maxSteps}` };
  if (c.maxTokens !== undefined) return { pass: (o.tokens ?? Infinity) <= c.maxTokens, why: `${o.tokens ?? '?'} tokens ≤ ${c.maxTokens}` };
  if (c.judge !== undefined) {
    try { const j = await judge(c.judge, prompt, o); return { pass: j.pass, why: `judge: ${j.why}` }; }
    catch (e) { return { pass: false, why: `judge could not answer: ${e.message}` }; }
  }
  return { pass: false, why: `unknown check ${JSON.stringify(c)}` };
}

/** Every check of a case, in order; a turn that failed or was stopped fails them all. */
async function evaluate(kase, outcome) {
  if (outcome.state !== 'done') return (kase.checks || []).map(c => ({ check: c, pass: false, why: `the turn ${outcome.state}: ${String(outcome.error || '').slice(0, 200)}` }));
  const out = [];
  for (const c of kase.checks || []) out.push({ check: c, ...(await one(c, kase.prompt, outcome)) });
  return out;
}

module.exports = { evaluate, one };

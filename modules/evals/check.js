'use strict';

/**
 * Whether one case's outcome passes its checks (TODO H10.1). An outcome is what the turn did, read from its run and
 * trace — `{ text, tools: [names in order], steps, tokens, ms, state, error }` — and each check is one line a person
 * can read:
 *
 *   { contains: 'x' } / { notContains: 'x' }   in the answer, ignoring case
 *   { matches: 'regex' }                        the answer, case-insensitive
 *   { tool: 'name' } / { noTool: 'name' }       called, or never called (a tool name or an mcp__server__ prefix)
 *   { anyTool: ['a', 'b'] }                     at least one of them called (more than one right way)
 *   { maxSteps: n } / { maxTokens: n }          what the turn took
 *   { judge: 'rubric' }                         one model call with no tools judges the answer against the rubric
 *   { lane: 'job' }                             what the front did: talk, look, do-now, job or amend (follow.js laneOf)
 *   { maxChildren: n } / { minChildren: n }     how many work chats it handed work to
 *   { maxFirstMs: n }                           the first word, thought or call came within n ms
 * With --follow the tool checks read the front's tools and its work chats' together (`allTools`).
 *
 * The judge is the harness's own `ask` (no tools, no memory, no charter): it reads the question, the rubric and the
 * answer, with the turn's calls in order, and its first word is PASS or FAIL. It is the only check that spends tokens. Comparing models, one judge grades
 * them all (DOCA_EVAL_JUDGE: --judge, else the hub's configured model), never the model under test.
 */
const named = (tools, name) => tools.some(t => t === name || (name.endsWith('__') && t.startsWith(name)));

/** The calls a judge reads: name and a clipped line of arguments (run.js `calls`), else names; none said as such. */
function calledLines(o) {
  const calls = (o.calls?.length ? o.calls : (o.allTools || o.tools || []).map(name => ({ name, args: '' }))).slice(0, 40);
  return calls.length ? calls.map((c, i) => `${i + 1}. ${c.name}${c.args ? ` ${String(c.args).slice(0, 120)}` : ''}`).join('\n') : '(none)';
}

async function judge(rubric, prompt, outcome) {
  // A comparison's one judge (bin/doca-eval.js sets it): `provider/model`, never the model under test.
  const [jp, ...jm] = String(process.env.DOCA_EVAL_JUDGE || '').split('/');
  const reply = await require('../harness/agent').ask({ ...(jp && jm.length ? { provider: jp, model: jm.join('/') } : {}),
    system: 'You grade an AI assistant\'s turn against a rubric: what it did (the tools it called, in order) and what it answered. Reply with PASS or FAIL as the first word, then one short sentence saying why. Judge only what the rubric asks.',
    // What it did, not only what it said (audit 2026-10-17: three models read the android-app skill first and were failed
    // for "not reading a procedure", because the judge saw only the final words).
    user: `Question:\n${prompt}\n\nRubric:\n${rubric}\n\nTools it called, in order:\n${calledLines(outcome)}\n\nAnswer:\n${String(outcome.text || '').slice(0, 6000)}`,
  });
  return { pass: /^\W*pass\b/i.test(reply), why: reply.replace(/^\W*(pass|fail)\b[:.\s-]*/i, '').slice(0, 300) };
}

/** A check's line says what happened, pass or fail: one `why` for both read "never called shell" when shell was called. */
const said = (pass, yes, no) => ({ pass, why: pass ? yes : no });
const calledList = tools => tools.length ? `it called ${[...new Set(tools)].join(', ')}` : 'it called no tool';

async function one(c, prompt, o) {
  const text = String(o.text || '');
  const tools = o.allTools || o.tools || [];
  const has = s => text.toLowerCase().includes(String(s).toLowerCase());
  if (c.contains !== undefined) return said(has(c.contains), `answer contains "${c.contains}"`, `answer does not contain "${c.contains}"`);
  if (c.notContains !== undefined) return said(!has(c.notContains), `answer does not contain "${c.notContains}"`, `answer contains "${c.notContains}", which it should not`);
  if (c.matches !== undefined) {
    try { return said(new RegExp(c.matches, 'i').test(text), `answer matches /${c.matches}/`, `answer does not match /${c.matches}/`); }
    catch (e) { return { pass: false, why: `bad pattern: ${e.message}` }; }
  }
  if (c.tool !== undefined) return said(named(tools, c.tool), `called ${c.tool}`, `never called ${c.tool} (${calledList(tools)})`);
  if (c.anyTool !== undefined) { const any = [].concat(c.anyTool); return said(any.some(n => named(tools, n)), `called one of ${any.join(', ')}`, `called none of ${any.join(', ')} (${calledList(tools)})`); }
  if (c.noTool !== undefined) return said(!named(tools, c.noTool), `never called ${c.noTool}`, `called ${c.noTool}, which it should not (${tools.filter(t => named([t], c.noTool)).length}×)`);
  if (c.maxSteps !== undefined) return said((o.steps ?? Infinity) <= c.maxSteps, `${o.steps ?? '?'} steps ≤ ${c.maxSteps}`, `${o.steps ?? '?'} steps, more than ${c.maxSteps}`);
  if (c.maxTokens !== undefined) return said((o.tokens ?? Infinity) <= c.maxTokens, `${o.tokens ?? '?'} tokens ≤ ${c.maxTokens}`, `${o.tokens ?? '?'} tokens, more than ${c.maxTokens}`);
  if (c.lane !== undefined) return said(o.lane === c.lane, `lane ${o.lane}`, `lane ${o.lane ?? '?'}, expected ${c.lane}`);
  if (c.maxChildren !== undefined) return said((o.children ?? 0) <= c.maxChildren, `${o.children ?? 0} work chats ≤ ${c.maxChildren}`, `${o.children} work chats, more than ${c.maxChildren}`);
  if (c.minChildren !== undefined) return said((o.children ?? 0) >= c.minChildren, `${o.children ?? 0} work chats ≥ ${c.minChildren}`, `${o.children ?? 0} work chats, fewer than ${c.minChildren}`);
  if (c.maxFirstMs !== undefined) return said(o.firstMs != null && o.firstMs <= c.maxFirstMs, `first output at ${o.firstMs} ms ≤ ${c.maxFirstMs}`, `first output at ${o.firstMs ?? '?'} ms, later than ${c.maxFirstMs}`);
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

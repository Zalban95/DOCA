'use strict';

/**
 * /api/harness/memory/rules — the rules the agent keeps its memory by: read,
 * write, reset, review, and now answer the review's questions and undo.
 *
 * Moved out of routes.js (2026-09-25) when answering arrived.
 */
const memory = require('./memory');
const agent  = require('./agent');

function fail(res, e) { res.status(e.status || 500).json({ error: e.message }); }
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e); } };

/**
 * The review's questions, as data. The reviewer writes each as
 * `?? question || choice || choice`; those lines come out of the text and into
 * `questions`, and the text keeps its heading so the review still reads whole.
 */
function splitQuestions(review) {
  const questions = [];
  const kept = [];
  for (const line of String(review || '').split('\n')) {
    const m = line.replace(/^\s*[-*\d.)]*\s*/, '').match(/^\?\?\s*(.+)$/);
    if (!m) { kept.push(line); continue; }
    const [question, ...choices] = m[1].split('||').map(x => x.trim()).filter(Boolean);
    if (question) questions.push({ question, choices: choices.slice(0, 4) });
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { review: questions.length ? `${text}\n(${questions.length} question${questions.length === 1 ? '' : 's'} below, to answer)` : text, questions };
}

const handleRulesGet = wrap(async (_req, res) =>
  res.json({ rules: memory.rules(), defaults: memory.DEFAULT_RULES }));

const handleRulesWrite = wrap(async (req, res) =>
  res.json({ ok: true, rules: memory.rulesWrite({ ...req.body, source: 'user' }) }));

const handleRulesReset = wrap(async (_req, res) =>
  res.json({ ok: true, rules: memory.rulesReset() }));

/**
 * POST /api/harness/memory/rules/verify — read the rules for sense, change nothing.
 *
 * Both sides write these rules, which is the point of them and also the risk: a
 * rule the agent added months ago can contradict one the user just typed, name a
 * category that no longer exists, or be so vague that following it is a coin
 * toss. Nobody notices, because the file is only ever read by a model.
 *
 * So this asks a model to review them — with no tools, no memory and no
 * conversation (`agent.ask`), because reviewing text is not a job that needs
 * authority — and returns findings and questions. **It never writes.** A rule is
 * the user's to change (Rules modal) or the agent's (`memory_rules_write`); a
 * reviewer that edited them would be a third author nobody asked for.
 */
const handleRulesVerify = wrap(async (req, res) => {
  const doc = memory.rules();
  const proposed = req.body && typeof req.body === 'object' && (req.body.rules || req.body.categories)
    ? { categories: req.body.categories || doc.categories, rules: req.body.rules || doc.rules }
    : doc;

  const catalogue = proposed.categories.map(c => `- ${c.id}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const listing   = proposed.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  // Written to find what would make an assistant act wrongly, not every word a
  // pedant could question. The first version asked for "rules whose meaning
  // depends on a judgement" and "a category with no rule about when to use it";
  // a careful model then listed nearly every rule as unclear and every category
  // as a gap, although each category's description says what goes in it
  // (2026-09-25). A review that flags everything tells the owner nothing.
  // The goal is a useful memory, not a list of conflicts. A reviewer told to
  // find conflicts always finds some — each pass explored new corners, fixing
  // one surfaced the next, and the rules never came to rest (2026-09-26). So it
  // judges usefulness in context, reports only what would cause a real mistake,
  // treats "no changes needed" as the good outcome, and is given what the owner
  // has already decided so it never re-opens it.
  const decided = memory.rulesDecisions();
  const system = [
    'You check the short rulebook an assistant follows when it writes its long-term memory. Your aim is to',
    'tell the owner whether these rules let it keep a memory that is useful in later conversations — not to',
    'find conflicts. The assistant applies the rules with judgment, in context, the way a capable colleague',
    'would; a case that sensible judgment settles is not a problem, and neither is an unusual edge case.',
    '',
    'The rules are written by this guide:',
    ...memory.GUIDE.map(g => `- ${g}`),
    '',
    'What the assistant already knows: each category\'s description says what belongs in it; a locked entry',
    'is one the owner locked in the panel; memory_flag marks an entry doubtful without removing it.',
    ...(decided.length ? ['', 'The owner has already decided these. They are settled: never raise them again, in any form.',
      ...decided.map(d => `- ${d.question} → ${d.answer}`)] : []),
    '',
    'Report, in this order and nothing else:',
    'PROBLEMS — at most three: something in these rules likely to make the assistant do the wrong thing in',
    'normal use. For each: the rule, the ordinary situation where it goes wrong, and what would go wrong.',
    'QUESTIONS — at most two, only for a problem above that only the owner can settle, each on its own line as',
    '?? the question || a first choice || a second choice',
    'with two to four short, concrete choices, each a complete answer.',
    '',
    'If nothing is likely to cause a real mistake, write only: No changes needed. That is a good result, and',
    'the most common one for rules that have already been reviewed. Do not add findings to have something to say.',
    'Do not rewrite the rules, do not propose replacement text, and do not comment on anything outside them.',
  ].join('\n');

  const review = await agent.ask({
    system,
    user: `Categories:\n${catalogue || '(none)'}\n\nRules:\n${listing || '(none)'}`,
  });

  res.json({
    ok: true,
    checked: { categories: proposed.categories.length, rules: proposed.rules.length },
    // By content, not by identity: the Rules modal always posts its textareas,
    // so an unedited draft is a different object saying the same thing, and
    // telling the user their saved rules are "unsaved" is a small lie.
    saved: JSON.stringify([proposed.categories, proposed.rules]) === JSON.stringify([doc.categories, doc.rules]),
    // The questions come back as data as well as text, so the panel can offer
    // them as choices to click (agent-ui/question-card.js) rather than prose.
    ...splitQuestions(review),
  });
});

/**
 * POST { question, answer } — the owner answered a review question; the rules
 * are changed to carry the answer out, and the previous version is kept, so
 * this is automatic and undoable rather than a draft to copy by hand.
 */
const handleRulesAnswer = wrap(async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 500);
  const answer   = String(req.body?.answer || '').trim().slice(0, 2000);
  if (!question || !answer) throw Object.assign(new Error('A question and an answer are needed.'), { status: 400 });
  const doc = memory.rules();
  const system = [
    'You maintain the rulebook an assistant follows when it writes its long-term memory. The owner has',
    'answered a question about it. Change the rules and categories so that they carry the answer out —',
    'only what the answer settles; keep every other rule word for word and in the same order.',
    'Write any rule you change or add by this guide:',
    ...memory.GUIDE.map(g => `- ${g}`),
    'Each rule at most 300 characters, each category description at most 200.',
    'Reply with JSON only, no fences: {"categories":[{"id":"…","description":"…"}],"rules":["…"],"summary":"one sentence saying what changed"}',
  ].join('\n');
  const user = `Categories:\n${JSON.stringify(doc.categories)}\n\nRules:\n${doc.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    + `\n\nQuestion: ${question}\nThe owner's answer: ${answer}`;
  const raw = await agent.ask({ system, user });
  let next;
  try { next = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw Object.assign(new Error('The model did not return the rules in a form that can be applied. Nothing was changed; try again, or edit them by hand.'), { status: 502 }); }
  if (!Array.isArray(next.rules) || !Array.isArray(next.categories))
    throw Object.assign(new Error('The model returned no rules to apply. Nothing was changed.'), { status: 502 });
  const rules = memory.rulesWrite({ categories: next.categories, rules: next.rules, source: 'owner answer' });
  memory.rulesDecide({ question, answer });   // settled: the reviewer will not raise it again
  res.json({ ok: true, summary: String(next.summary || 'The rules were updated.').slice(0, 300), rules });
});

/** POST — back to the version before the last change. */
const handleRulesUndo = wrap(async (_req, res) => res.json({ ok: true, rules: memory.rulesUndo() }));

function mount(app) {
  app.get   ('/api/harness/memory/rules',         handleRulesGet);
  app.post  ('/api/harness/memory/rules/verify',  handleRulesVerify);
  app.post  ('/api/harness/memory/rules/answer',  handleRulesAnswer);
  app.post  ('/api/harness/memory/rules/undo',    handleRulesUndo);
  app.post  ('/api/harness/memory/rules',         handleRulesWrite);
  app.delete('/api/harness/memory/rules',         handleRulesReset);
}

module.exports = { mount, splitQuestions };

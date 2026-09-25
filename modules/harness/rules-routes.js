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
  const system = [
    'You review a short rulebook that another assistant follows when it decides what to write into its',
    'long-term memory. Read it as that assistant would: capable, in good faith, and using ordinary words in',
    'their ordinary sense. Your job is to find what would make it act wrongly — not to question every word.',
    '',
    'The owner writes rules by this guide; a rule that breaks it is a finding:',
    ...memory.GUIDE.map(g => `- ${g}`),
    '',
    'What the assistant already knows, so none of it is a finding:',
    '- Each category\'s description says what belongs in it. That description is the rule for when to use it.',
    '- A locked entry is one the user has locked in the panel; the assistant cannot change or remove it.',
    '- memory_flag marks an entry as doubtful, with a reason, without removing it.',
    '',
    'Report, in this order and nothing else:',
    'CONFLICTS — two rules that a realistic situation forces the assistant to choose between. Name both by',
    'number and the situation, in a few words. A clash that needs a contrived case is not a conflict.',
    'UNCLEAR — wording that would lead two careful assistants to do different things in a situation that will',
    'actually come up. Quote the wording and name the situation. A word that ordinary sense settles is fine.',
    'GAPS — a category with no description, or two whose descriptions overlap so the same fact could go in',
    'either; a rule that names a category that is not listed; or a common kind of fact that fits no category.',
    'QUESTIONS — at most three questions for the person who owns these rules, each one whose answer would fix',
    'a finding above. Ask nothing you could answer from the rules themselves. Write each on its own line as',
    '?? the question || a first choice || a second choice',
    'with two to four short, concrete choices, each one a complete answer the owner could pick.',
    '',
    'One line per finding, starting with the rule number or category. Most rulebooks have few real findings:',
    'write "none" under a heading that has none, and do not add findings to fill one.',
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

'use strict';

/**
 * How the agent keeps its memory: the categories facts are filed under, the
 * rules it follows when writing them, how a rule is written well, and the
 * history that makes any change to them undoable.
 *
 * Moved out of memory.js (2026-09-25) when rules grew a history and a guide;
 * memory.js re-exports all of it, so callers did not change.
 */
const store = require('../store');

const RULES_DOC   = 'harness/memory-rules';
const HISTORY_DOC = 'harness/memory-rules-history';
const HISTORY_KEEP = 10;

/**
 * How a rule for this memory is written. One text, read by the agent when it
 * writes a rule (memory_rules_write) and by the reviewer when it checks them
 * (POST /api/harness/memory/rules/verify), so the two can never disagree about
 * what a good rule is. Skills are meant to get the same (TODO.md).
 */
const GUIDE = [
  'One behaviour per rule, as an instruction: what to do, and in which case.',
  'Where a word could be read two ways, settle it with an example in the rule (not "stale" alone: "a container id, a PID").',
  'If a rule can meet another in a real case, say which one wins, or that the owner decides.',
  'A category is its description: what belongs in it. No two descriptions may fit the same fact; say which wins where they touch.',
  'Refer only to categories that exist, and to tools and terms the agent has (memory_flag, locked entries, pins).',
  'Refer to another rule by what it says, never by its number: numbers change whenever a rule is added or removed.',
  'Keep the set short: every rule is read on every turn.',
];

/**
 * How memory is meant to be kept — categories and house rules, in the prompt
 * every turn.
 *
 * These are the shipped defaults, not the law: the agent can rewrite them with
 * `memory_rules_write` and the user can edit them in the console, because the
 * one keeping this memory is the one best placed to say what belongs in it.
 * What the agent cannot edit is the safety charter in `providers.js` — a rule
 * about not storing secrets that the agent could delete would be worth nothing.
 */
const DEFAULT_RULES = {
  categories: [
    { id: 'machine', description: 'The host itself: hardware, OS, GPUs, disks, network interfaces. Not the services running on it (stack) or where files are (paths).' },
    { id: 'paths', description: 'Where files and folders live on this machine, and which of them the panel manages.' },
    { id: 'stack', description: 'How each service, container and model is set up and run: its ports, the location of its config file, how to start and check it.' },
    { id: 'prefs', description: "The owner's standing instructions and preferences about how you work, in their words, dated." },
    { id: 'project', description: "Settled facts about code and projects in the workspace: structure, conventions (the owner's included), decisions." },
    { id: 'open', description: 'Unfinished work and threads to pick up later, half-done code tasks included. When one is finished, its result moves to project.' },
  ],
  rules: [
    'These rules exist to keep a memory that is useful in later conversations. Apply them with judgment: where one does not fit the case in front of you, do what serves that purpose and say what you did.',
    'One fact per entry. Key it subject first, then aspect, lower case with dashes (ollama-port, root-disk-size). Before adding, memory_search the subject and reuse its key rather than adding a second one.',
    'Never store a secret, key, token or password, not even inside a quote. Store where it lives instead (deepseek-api-key: in ~/.openclaw/openclaw.json). This holds for locked entries too: remove a secret from one and tell the owner.',
    'Store what someone configured (ports, IPs, versions, paths). Do not store what changes by itself (a container id, a PID, free RAM): store how to find it out instead.',
    "File a fact where the most specific category description fits: a service's port or config location in stack, even when the owner is the one who changed it; a code convention in project; a half-done task in open.",
    "The owner's standing instructions about how you work go under prefs, in their words, with the date. A preference stated in passing counts.",
    'When a fact comes from your reasoning rather than from something you ran or read, end it with (inferred from ...).',
    'Pin only what every conversation needs, and never more than ten: unpin one before pinning an eleventh.',
    'When a remembered fact turns out wrong, flag it with memory_flag in the same turn, saying what contradicted it, and replace it once you have checked the right answer or the owner has given it.',
    "A locked entry is the owner's settled answer: never change or duplicate it, even when it looks wrong. Flag it and ask the owner. The only exception is a secret in it (see the rule on secrets).",
    'When it matters which of two rules applies and judgment does not settle it, ask the owner one short question. Until they answer, store nothing and change nothing.',
  ],
};

function rules() {
  const doc = store.readJson(RULES_DOC, null);
  if (!doc || !Array.isArray(doc.rules) || !Array.isArray(doc.categories))
    return { ...DEFAULT_RULES, source: 'default', updatedAt: null };
  return doc;
}

/**
 * Replace the categories, the rules, or both. Whatever is left out is kept, so
 * "add a rule" is a read plus a write of the one list that changed.
 *
 * Bounded on purpose: this text is in the system prompt of every turn, and an
 * agent that keeps appending to its own instructions would quietly eat the
 * context window it was trying to spend well.
 */
function rulesWrite({ categories, rules: list, source } = {}) {
  const current = rules();

  const nextCats = categories === undefined ? current.categories
    : (Array.isArray(categories) ? categories : [])
      .map(c => (typeof c === 'string'
        ? { id: c.trim().slice(0, 40), description: '' }
        : { id: String(c?.id || '').trim().slice(0, 40), description: String(c?.description || '').trim().slice(0, 200) }))
      .filter(c => c.id)
      .slice(0, 20);

  const nextRules = list === undefined ? current.rules
    : (Array.isArray(list) ? list : String(list).split('\n'))
      // A list shown numbered comes back numbered; the number is not part of the rule.
      .map(r => String(r).trim().replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s+/, '').slice(0, 300))
      .filter(Boolean)
      .slice(0, 30);

  if (!nextCats.length)  throw Object.assign(new Error('at least one category is required'), { status: 400 });
  if (!nextRules.length) throw Object.assign(new Error('at least one rule is required'), { status: 400 });

  const doc = {
    categories: nextCats,
    rules: nextRules,
    source: source || 'user',
    updatedAt: new Date().toISOString(),
  };
  remember(current);
  store.writeJson(RULES_DOC, doc);
  return doc;
}

/**
 * Change one rule without retyping the rest.
 *
 * `rulesWrite` replaces a whole list, which is right for the modal — the user is
 * looking at all of them — and wrong for the agent, which reaches for it to add
 * a single line and has to reproduce twenty-nine others from memory to do it.
 * Every one it forgets is silently deleted. This is the selective form: the
 * lists it does not mention are not touched, and neither are the entries it
 * does not name.
 *
 * @param {{ add?: string[], remove?: (number|string)[], replace?: {index:number, text:string}[],
 *           addCategories?: object[], removeCategories?: string[], source?: string }} input
 */
function rulesPatch({ add, remove, replace, addCategories, removeCategories, source } = {}) {
  const current = rules();
  let list = [...current.rules];
  let cats = [...current.categories];

  // Replace first, while the indexes still mean what the caller saw.
  for (const r of (Array.isArray(replace) ? replace : [])) {
    const i = Number(r?.index);
    if (!Number.isInteger(i) || i < 1 || i > list.length)
      throw Object.assign(new Error(`there is no rule ${r?.index} to replace (1-${list.length})`), { status: 400 });
    const text = String(r?.text ?? '').trim().replace(/^[-*]\s*/, '').slice(0, 300);
    if (!text) throw Object.assign(new Error(`rule ${i}: replacement text is empty`), { status: 400 });
    list[i - 1] = text;
  }

  // Then remove, by number or by the text itself, highest index first so the
  // earlier ones keep their positions.
  const drop = new Set();
  for (const r of (Array.isArray(remove) ? remove : [])) {
    if (typeof r === 'number' || /^\d+$/.test(String(r))) {
      const i = Number(r);
      if (!Number.isInteger(i) || i < 1 || i > list.length)
        throw Object.assign(new Error(`there is no rule ${r} to remove (1-${list.length})`), { status: 400 });
      drop.add(i - 1);
    } else {
      const i = list.findIndex(x => x === String(r).trim());
      if (i < 0) throw Object.assign(new Error(`no rule reads exactly "${String(r).slice(0, 60)}"`), { status: 400 });
      drop.add(i);
    }
  }
  list = list.filter((_, i) => !drop.has(i));

  for (const r of (Array.isArray(add) ? add : [])) {
    const text = String(r ?? '').trim().replace(/^[-*]\s*/, '').slice(0, 300);
    if (text && !list.includes(text)) list.push(text);
  }

  for (const c of (Array.isArray(addCategories) ? addCategories : [])) {
    const id = String((typeof c === 'string' ? c : c?.id) || '').trim().slice(0, 40);
    if (!id || cats.some(x => x.id === id)) continue;
    cats.push({ id, description: String((typeof c === 'string' ? '' : c?.description) || '').trim().slice(0, 200) });
  }
  if (Array.isArray(removeCategories) && removeCategories.length) {
    const gone = new Set(removeCategories.map(x => String(x).trim()));
    cats = cats.filter(c => !gone.has(c.id));
  }

  return rulesWrite({ categories: cats, rules: list, source: source || 'agent' });
}

/** Back to the shipped rules, for when an experiment made them worse. */
function rulesReset() {
  remember(rules());
  store.removeJson(RULES_DOC);
  return rules();
}

/* ── History: every change is undoable ─────────────────── */

/** Keep what the rules were before a write, so an automatic change can be taken back. */
function remember(previous) {
  const list = store.readJson(HISTORY_DOC, []);
  list.push({ ...previous, replacedAt: new Date().toISOString() });
  store.writeJson(HISTORY_DOC, list.slice(-HISTORY_KEEP));
}

/** The versions kept, newest last. */
function rulesHistory() { return store.readJson(HISTORY_DOC, []); }

/** Put the previous version back. The version undone is not kept: undo is not a new change. */
function rulesUndo() {
  const list = store.readJson(HISTORY_DOC, []);
  const prev = list.pop();
  if (!prev) throw Object.assign(new Error('There is no earlier version of the rules to go back to.'), { status: 409 });
  store.writeJson(HISTORY_DOC, list);
  if (prev.source === 'default') store.removeJson(RULES_DOC);
  else store.writeJson(RULES_DOC, { categories: prev.categories, rules: prev.rules, source: prev.source, updatedAt: new Date().toISOString() });
  return rules();
}

/* ── What the owner has decided ───────────────────────────
   Every answer to a review question is kept, and the reviewer is told these
   are settled — otherwise each review re-opened what the owner had just
   decided, and the rules never came to rest (2026-09-26). */
const DECISIONS_DOC = 'harness/memory-rules-decisions';
function rulesDecisions() { return store.readJson(DECISIONS_DOC, []); }
function rulesDecide({ question, answer }) {
  const list = rulesDecisions().filter(d => d.question !== question);
  list.push({ question: String(question).slice(0, 500), answer: String(answer).slice(0, 1000), at: new Date().toISOString() });
  store.writeJson(DECISIONS_DOC, list.slice(-30));
}

module.exports = { rulesDecisions, rulesDecide, GUIDE, DEFAULT_RULES, rules, rulesWrite, rulesPatch, rulesReset, rulesHistory, rulesUndo };

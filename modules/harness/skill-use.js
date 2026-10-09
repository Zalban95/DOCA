'use strict';

/**
 * How each skill is used (asked 2026-10-09: "in code or projects, depending on if we are using plan, auto, ask,
 * debug… the relative skill is attached"; and "the skill management can be in settings so that if a skill is needed
 * not for coding specifically it can be called by the agent in specific requests"). Three ways, per skill:
 *
 *   fits      what every skill did before: the agent sees its name and when to use it, "Likely fits" offers it, and it
 *             reads it on a matching request. The default for every skill that does not say otherwise.
 *   attached  its instructions go with every turn of a conversation in the modes named (Agent, Plan, Ask, Debug) —
 *             `where: project` only in a conversation working in a project or a worktree (a chat about the weather
 *             carries no coding rules). Attached skills stay findable "when it fits" in every other conversation.
 *   off       the agent does not see it: not in its manifest, not offered, not readable by the `skill` tool. A person
 *             may still attach it to one chat by name — that is their decision.
 *
 * Where it is decided, the nearest winning: the chat (`session.skills {add, remove}`, the conv-bar's chip and
 * `/skill`), the project (`modeSkills {mode: [names]}`, a list per mode replacing the hive's for that mode), the hive
 * (prefs `skillUse {name: {use, modes, where}}`, Settings → Harness → Skills), else the skill's own front matter
 * (`attach-modes: [agent, debug]`, `attach-where: project`), so a shipped default reaches every install that never
 * chose. What is attached is a block in the system prompt right after the skills manifest (turn/prompt.js,
 * orchestrator-prompt.js): the same bytes on every step and every turn until the attachments change, so the provider's
 * cached prefix stays put — one miss per change, never per step. A skill attached for one message is not here: it is
 * written into the transcript once (skill-next.js).
 */
const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const { split, parseList } = require('../agents/markdown');

const MODES = ['agent', 'plan', 'ask', 'debug'];
const USES = ['fits', 'attached', 'off'];
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ONE = 3500, MAX_ALL = 9000;
const FROM = { chat: 'this chat', project: 'this project', hive: 'Settings → Harness → Skills' };
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const listOf = v => (Array.isArray(v) ? v : parseList(v)).map(String);

/** A use as stored, made safe: unknown values fall back to "when it fits"; triggers are words or short phrases. */
function normalize(v = {}) {
  const use = USES.includes(v.use) ? v.use : 'fits';
  const modes = [...new Set(listOf(v.modes || []).filter(m => MODES.includes(m)))];
  return { use, modes: use === 'attached' ? modes : [], where: v.where === 'project' ? 'project' : 'any', triggers: triggerList(v.triggers) };
}
const triggerList = v => [...new Set(listOf(v || []).map(t => t.replace(/\s+/g, ' ').trim().toLowerCase()).filter(t => t && t.length <= 60))].slice(0, 30);

/** What the skill's own front matter asks for, when nobody chose: attach-modes, attach-where, triggers. */
function defaultOf(s) {
  let meta = {};
  try { meta = split(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8')).meta; } catch { /* unreadable: when it fits */ }
  const modes = listOf(meta['attach-modes'] || []).filter(m => MODES.includes(m));
  return normalize({ ...(modes.length ? { use: 'attached', modes, where: meta['attach-where'] } : {}), triggers: meta.triggers });
}

const chosen = () => { try { return require('../utils').loadPrefs().skillUse || {}; } catch { return {}; } };

/**
 * Every skill with how it is used: the hive's choice over the skill's own, field by field (a person who only wrote
 * triggers keeps the skill's attachment), `from` saying whether anything was chosen here.
 */
function all() {
  const own = chosen();
  return require('./skills').list().map(s => {
    const def = defaultOf(s), mine = own[s.name];
    if (!mine) return { ...s, ...def, from: 'default' };
    const n = normalize({ use: mine.use ?? def.use, modes: mine.modes ?? def.modes, where: mine.where ?? def.where, triggers: mine.triggers ?? def.triggers });
    return { ...s, ...n, from: 'setting', byDefault: def };
  });
}

/** The skills the agent sees unasked: every one not switched off. */
function offered() { return all().filter(s => s.use !== 'off'); }
function isOff(name) { return all().some(s => s.name === name && s.use === 'off'); }

/**
 * What is attached to a conversation now, each with where it came from: the hive's for its mode (or the project's
 * list for that mode), less what the chat removed, plus what the chat added.
 */
function resolve(sessionId) {
  const session = memory.getSession(sessionId);
  const mode = require('./modes').of(sessionId);
  let project = null;
  try { project = require('../projects/store').forSession(sessionId); } catch { /* no projects */ }
  const known = new Map(all().map(s => [s.name, s]));
  const own = project?.modeSkills?.[mode];
  let list = Array.isArray(own) ? own.map(name => ({ name, from: 'project' }))
    : [...known.values()].filter(s => s.use === 'attached' && s.modes.includes(mode) && (s.where === 'any' || project))
      .map(s => ({ name: s.name, from: 'hive' }));
  const chat = session?.skills || {};
  const removed = new Set(chat.remove || []);
  list = list.filter(x => !removed.has(x.name));
  for (const name of chat.add || []) if (!list.some(x => x.name === name)) list.push({ name, from: 'chat' });
  return { mode, inProject: !!project, removed: [...removed].filter(n => known.has(n)),
    skills: list.filter(x => known.has(x.name)).map(x => ({ ...x, where: FROM[x.from], description: known.get(x.name).description })) };
}

/** The prompt block: each attached skill's instructions, once per turn. '' when none. */
function block(sessionId) {
  if (!sessionId || !memory.getSession(sessionId)) return '';
  const r = resolve(sessionId);
  if (!r.skills.length) return '';
  const label = require('./modes').MODES[r.mode].label;
  const out = [`# Skills attached to this conversation (${label} mode) — follow them throughout, not only when asked`];
  let used = 0;
  for (const x of r.skills) {
    let body = '';
    try { body = require('./skills').read(x.name).body.trim(); } catch { continue; }
    if (body.length > MAX_ONE) body = `${body.slice(0, MAX_ONE)}\n… (the rest: \`skill\` read ${x.name})`;
    if (used + body.length > MAX_ALL) { out.push(`## ${x.name} — attached; read it with \`skill\` read ${x.name}`); continue; }
    used += body.length;
    out.push(`## ${x.name} (attached by ${x.where})\n${body}`);
  }
  return out.join('\n\n');
}

/** Attach or detach skills for one chat. `add`/`remove`: names. Returns what is attached now. */
function setChat(sessionId, { add = [], remove = [] } = {}) {
  const session = memory.getSession(sessionId);
  if (!session) throw bad('Unknown conversation', 404);
  const known = new Set(require('./skills').list().map(s => s.name));
  const chat = { add: [...(session.skills?.add || [])], remove: [...(session.skills?.remove || [])] };
  for (const name of listOf(add)) {
    if (!known.has(name)) throw bad(`No skill called "${name}". Settings → Harness → Skills lists them.`, 404);
    chat.remove = chat.remove.filter(n => n !== name);
    if (!resolve(sessionId).skills.some(x => x.name === name) && !chat.add.includes(name)) chat.add.push(name);
  }
  for (const name of listOf(remove)) {
    chat.add = chat.add.filter(n => n !== name);
    memory.updateSession(sessionId, { skills: chat });
    if (resolve(sessionId).skills.some(x => x.name === name) && !chat.remove.includes(name)) chat.remove.push(name);
  }
  memory.updateSession(sessionId, { skills: chat.add.length || chat.remove.length ? chat : null });
  return resolve(sessionId);
}

/** A project's own lists per mode, checked (projects/store.js update): null clears a mode, back to the hive's. */
function projectLists(v) {
  if (v === null) return null;
  const out = {};
  for (const [mode, names] of Object.entries(v || {})) {
    if (!MODES.includes(mode)) throw bad(`A mode is one of ${MODES.join(', ')}.`);
    if (names === null) continue;
    const list = listOf(names);
    for (const n of list) if (!NAME.test(n)) throw bad(`"${n}" is not a skill name.`);
    out[mode] = [...new Set(list)].slice(0, 20);
  }
  return Object.keys(out).length ? out : null;
}

module.exports = { MODES, USES, all, offered, isOff, resolve, block, setChat, projectLists, normalize, defaultOf };

'use strict';

/**
 * What an agent type holds, and why (TODO H15.3): the Orchestrator, a work chat, or one specialist —
 * each tool with its kit, its first sentence (what the prompt's "Your tools" says) and the reason it
 * is held; and what the type is refused, with the reason. A missing tool is then visible in the panel
 * before a turn fails on it. The held set is `disabledFor`'s, the same answer the turns get.
 */
const tools = require('./tools');
const { KITS, kitOf } = require('./kits');
const { disabledFor, ALWAYS_FOR_SPECIALISTS, COMES_WITH } = require('./turn/prompt');
const { firstSentence } = require('./turn/tools-section');

function profileFor(type) {
  if (type === 'orchestrator') return require('./organization').profileFor({ kind: 'orchestrator' });
  if (type === 'work') return null;
  const registry = require('../agents/registry');
  const def = registry.get(type);
  if (!def || def.broken) throw Object.assign(new Error(`No readable agent called "${type}".`), { status: 404 });
  return { ...require('../agents/missions').profileOf(def), level: 'specialist' };
}

function reasonHeld(name, profile) {
  const kit = kitOf(name);
  const kitName = KITS[kit]?.label || 'Other';
  if (!profile) return `a work chat holds every kit (${kitName})`;
  if (profile.kits === '*') return `holds every kit (${kitName})`;
  if ((profile.tools || []).includes(name)) return 'named in its definition';
  if ((profile.kits || []).includes(kit)) return `its ${kitName} kit`;
  if (ALWAYS_FOR_SPECIALISTS.includes(name)) return 'every specialist plans and reports';
  const withTool = Object.entries(COMES_WITH).find(([n]) => n === name);
  if (withTool) return `comes with ${withTool[1].join(', ')}`;
  return 'granted to its type';
}

function reasonRefused(name, profile, p) {
  const registry = require('../agents/registry');
  if ((p.disabledTools || []).includes(name)) return 'switched off by the owner (⚙ tools)';
  if (registry.AIRLOCK_ONLY.includes(name) && registry.enabled() && !profile?.airlock) return 'the airlock: only an airlock specialist reads the web';
  if (profile && profile.level !== 'orchestrator' && registry.NEVER.includes(name)) return 'never a specialist\'s (registry NEVER)';
  if (/^mcp__computer-/.test(name)) return 'another conversation\'s computer';
  return null;   // simply not in its kits
}

/** @param {string} type 'orchestrator' | 'work' | a specialist id */
function roster(type) {
  const profile = profileFor(type);
  const p = require('./turn/params').turnParams(profile);
  const off = new Set(disabledFor(profile, p));
  const all = tools.describe();
  const held = [], refused = [];
  const wanted = n => !profile || profile.kits === '*' || (profile.tools || []).includes(n) || (profile.kits || []).includes(kitOf(n));
  for (const t of all) {
    const row = { name: t.name, kit: kitOf(t.name) || 'other', what: firstSentence(t.description) };
    if (!off.has(t.name)) held.push({ ...row, why: reasonHeld(t.name, profile) });
    else if (wanted(t.name)) refused.push({ ...row, why: reasonRefused(t.name, profile, p) || 'not held' });
  }
  return { type, label: profile?.label || 'Work chat', kits: profile ? profile.kits : '*', held, refused,
    kitLabels: Object.fromEntries(Object.entries(KITS).map(([k, v]) => [k, v.label])) };
}

module.exports = { roster };

'use strict';

/**
 * "# Your tools": what this turn is offered, by kit, one line each —
 * generated from the registry at prompt time, never written by hand.
 *
 * The audit of 2026-09-26 (N7) found the only capability text a model got was
 * an eight-line constant naming three tools, beside a tool count: every tool
 * added since (canvas, the project tools…) was named in no prompt at all. This
 * is the list the turn really has — after kits, the level's rules and the
 * owner's switches — so a tool added to a kit in a later release is described
 * by construction. Each line is the tool's written lead (tool-leads.js) or its description's first
 * sentence: what it does and when to use it, at most 150 characters.
 */
const { KITS, kitOf } = require('../kits');

function firstSentence(text, max = 150) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = s.search(/(?<!\b(?:e\.g|i\.e|etc))\.(\s|$)/);   // "e.g." is not the end of a sentence
  const one = cut > 0 ? s.slice(0, cut + 1) : s;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** The one line a tool gets in "Your tools": its written lead (tool-leads.js), else its first sentence. */
function lineFor(name, description) {
  return require('./tool-leads').LEADS[name] || firstSentence(description);
}

/**
 * @param {Array<{type:'function', function:{name, description}}>} schemas  the turn's tool declarations
 */
function toolsSection(schemas, named = []) {
  if (!schemas?.length) return '';
  const byKit = new Map();
  for (const s of schemas) {
    const name = s.function?.name;
    const kit = kitOf(name) || 'other';
    if (!byKit.has(kit)) byKit.set(kit, []);
    byKit.get(kit).push({ name, what: lineFor(name, s.function?.description) });
  }
  const order = [...Object.keys(KITS), 'other'];
  const lines = [`# Your tools — ${schemas.length}, by kit`,
    'Prefer the specific tool to shell: search_files over grep, replace_in_files over sed, git and project run over typed commands, canvas for anything that reads better as a page, and a tool made for the job — loaded or listed under More tools — over improvising one.',
    require('../untrusted').RULE];
  // Which way out, from the ways held — the airlock's "dispatch the scout" among them (reaching-out.js; aw 19).
  const outside = require('./reaching-out').block(new Set([...schemas.map(s => s.function?.name), ...(named || []).map(n => (typeof n === 'string' ? n : n?.name))].filter(Boolean)));
  if (outside) lines.push(outside);
  for (const kit of order) {
    const list = byKit.get(kit);
    if (!list) continue;
    lines.push(`${KITS[kit]?.label || 'Other'} — ${KITS[kit]?.about || 'more tools'}:`);
    // MCP servers can bring many tools; they are named, not described, to keep the prompt short.
    if (kit === 'mcp') lines.push(`  ${list.map(t => t.name).join(', ')}`);
    else for (const t of list) lines.push(`  ${t.name}: ${t.what}`);
  }
  const more = require('./tool-tiers').namedLine(named);   // tiers (tool-tiers.js): held, not loaded yet
  if (more) lines.push(more);
  return lines.join('\n');
}

module.exports = { toolsSection, firstSentence, lineFor };

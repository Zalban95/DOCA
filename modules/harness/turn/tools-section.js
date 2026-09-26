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
 * by construction. Each line is the tool's own description's first sentence,
 * which is written beside the tool.
 */
const { KITS, kitOf } = require('../kits');

function firstSentence(text, max = 150) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = s.search(/\.(\s|$)/);
  const one = cut > 0 ? s.slice(0, cut + 1) : s;
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * @param {Array<{type:'function', function:{name, description}}>} schemas  the turn's tool declarations
 */
function toolsSection(schemas) {
  if (!schemas?.length) return '';
  const byKit = new Map();
  for (const s of schemas) {
    const name = s.function?.name;
    const kit = kitOf(name) || 'other';
    if (!byKit.has(kit)) byKit.set(kit, []);
    byKit.get(kit).push({ name, what: firstSentence(s.function?.description) });
  }
  const order = [...Object.keys(KITS), 'other'];
  const lines = [`# Your tools — ${schemas.length}, by kit`,
    'Prefer the specific tool to shell: search_files over grep, replace_in_files over sed, git and project run over typed commands, canvas for anything that reads better as a page.',
    require('../untrusted').RULE];
  for (const kit of order) {
    const list = byKit.get(kit);
    if (!list) continue;
    lines.push(`${KITS[kit]?.label || 'Other'} — ${KITS[kit]?.about || 'more tools'}:`);
    // MCP servers can bring many tools; they are named, not described, to keep the prompt short.
    if (kit === 'mcp') lines.push(`  ${list.map(t => t.name).join(', ')}`);
    else for (const t of list) lines.push(`  ${t.name}: ${t.what}`);
  }
  return lines.join('\n');
}

module.exports = { toolsSection, firstSentence };

'use strict';

/**
 * What the agent has for this request, in the readings after the history (audit 2026-10-06, aw 21–22, 30; coh F18;
 * TODO B5): skills and recipes whose words match the person's ("Likely fits"), and the inventories that change — keys
 * for services, logins — which used to sit inside tool descriptions, breaking the cached prefix whenever one changed
 * and appearing nowhere a summary could see them. Readings are rebuilt per step and cost nothing in the cache.
 *
 * Choosing stays the model's (V8); this puts the candidates in front of it instead of leaving a skill to be
 * remembered from a manifest of names and a recipe to be found by an id at the end of a tool description.
 */
const { matcher } = require('../skill-match');

const TOP = 3;

function best(items, query) {
  const score = matcher(query);
  return items.map(it => ({ it, s: score({ name: it.name, description: it.description, body: it.body || '' }) }))
    .filter(x => x.s >= 4).sort((a, b) => b.s - a.s).slice(0, TOP).map(x => x.it);
}

/** "# Likely fits": the skills and recipes this request's words match, with how to use each. '' when none. */
function likely(message, held, sessionId = null, already = [], schemas = []) {
  const text = String(message || '').trim();
  if (!text) return '';
  const rows = [];
  if (held.has('skill')) {
    // A skill whose trigger words the request says comes first, flagged as the harness's (skill-triggers.js); the
    // ones already attached to this conversation are in the prompt already.
    let skills = [], hits = [];
    try {
      const attached = [...already, ...(sessionId ? require('../skill-use').resolve(sessionId).skills.map(x => x.name) : [])];
      hits = require('../skill-triggers').match(text, { skip: attached });
      skills = require('../skill-use').offered().filter(s => !attached.includes(s.name) && !hits.some(h => h.name === s.name));
    } catch { /* none */ }
    const by = require('../../branding').name('product');
    for (const h of hits) rows.push(`- Suggested by ${by}: skill ${h.name} (matched "${h.matched}"): ${String(h.description || '').slice(0, 160)} — \`skill\` read ${h.name}`);
    for (const s of best(skills, text).slice(0, Math.max(0, TOP - hits.length))) rows.push(`- skill ${s.name}: ${String(s.description || '').slice(0, 160)} — \`skill\` read ${s.name}`);
  }
  // Tools this request's words call for (tool-cues.js), loaded in full for this turn: the framework made for the job.
  try {
    const { cued, PURPOSE, mcpPurpose } = require('./tool-cues');
    for (const c of cued(text, schemas)) {
      const id = c.startsWith('mcp:') ? c.slice(4) : null;
      const tools = id ? schemas.map(s => s.function?.name || s.name).filter(n => n.startsWith(`mcp__${id}__`)).map(n => n.slice(`mcp__${id}__`.length)) : [];
      rows.push(id ? `- MCP server ${id}: ${mcpPurpose(id, tools)} — its tools are loaded (mcp__${id}__…)` : `- tool ${c}: ${PURPOSE[c] || ''} — loaded for this request`);
    }
    for (const a of require('./tool-cues').advice(text)) rows.push(`- ${a}`);
  } catch { /* none */ }
  if (held.has('recipe')) {
    let recipes = [];
    try { recipes = require('../../recipes/store').list().map(r => ({ name: r.id, description: `${r.title || ''}. ${r.description || ''}` })); } catch { /* none */ }
    for (const r of best(recipes, text)) rows.push(`- recipe ${r.name}: ${String(r.description).slice(0, 160)} — \`recipe\` run ${r.name}`);
  }
  return rows.length ? ['# Likely fits for this request (matched on its words; use one if it does exactly this)', ...rows].join('\n') : '';
}

/** "# What you have": keys for services, logins and secrets for devices by name (never a secret), and how many recipes are saved. */
function inventory(held, person = null) {
  const out = [];
  if (held.has('service')) {
    try {
      const ss = require('../../api-services/store').list().filter(s => s.actions.length);
      if (ss.length) out.push(`- API services with actions (\`service\` describe <name>): ${ss.map(s => `${s.name} (${s.actions.slice(0, 6).map(a => a.name).join(', ')}${s.actions.length > 6 ? ', …' : ''})`).join('; ')}.`);
    } catch { /* none */ }
  }
  if (held.has('api_call') || held.has('http_fetch')) {
    try { const l = require('../../service-keys').line().trim(); if (l) out.push(`- ${l}`); } catch { /* none */ }
  }
  if (held.has('computer_login')) {
    try {
      const ls = require('../../logins').list();
      out.push(`- Logins for computer_login: ${ls.length ? ls.map(l => `${l.label} (${l.site})`).join(', ') : 'none yet — ask the owner to add one (Field → Connectors → Logins)'}.`);
    } catch { /* none */ }
  }
  if (held.has('secret_use')) {
    try {
      // Whose turn it is decides which: the hub's on an admin's turn (and their own), a person's own on theirs (P1.3).
      const vault = require('../../sealed/vault');
      const host = !person?.id || require('../../auth/rights').can(person.role, 'host');
      const own = person?.id && !person.onBehalf ? vault.namesSync(person.id) : [];
      const ss = [...(host ? vault.namesSync('') : []), ...own];
      const names = ss.length ? ss.map(x => `${x.name}${x.origin ? ` (${x.origin})` : ''}`).join(', ') : 'none of its own yet';
      out.push(host ? `- Secrets for secret_use (by name; their values are never shown): ${names}; also login:<name> and key:<name>.`
        : `- ${person.name || 'Your person'}'s own secrets for secret_use, on their own devices (by name; their values are never shown): ${names}.`);
    } catch { /* none */ }
  }
  if (held.has('recipe')) {
    try { const n = require('../../recipes/store').list().length; if (n) out.push(`- ${n} saved recipe${n === 1 ? '' : 's'} (\`recipe\` list shows them).`); } catch { /* none */ }
  }
  return out.length ? ['# What you have', ...out].join('\n') : '';
}

/**
 * After a turn's tool calls worked — three or more, none failed, no recipe run — one line suggesting it be kept.
 * `rows` are the transcript rows since the person's message.
 */
function keepHint(rows, held) {
  if (!held.has('recipe')) return '';
  const calls = rows.filter(r => r.role === 'tool');
  if (calls.length < 3 || calls.some(r => /^Error|^Refused/.test(String(r.content || '')) || r.name === 'recipe')) return '';
  return 'This turn\'s steps have all worked. If this will come back, offer once to keep it: `recipe` save_last.';
}

/** The four, for one step — with the steps of a skill this turn read (skill-steps.js). */
function block({ message, schemas = [], rows = [], person = null, sessionId = null, turnRow = null }) {
  const held = new Set(schemas.map(s => s.function?.name || s.name));
  const attached = turnRow?.attachedSkills || [];   // attached to this request (skill-next.js): steps followed, not suggested again
  return [likely(message, held, sessionId, attached.map(a => a.name), schemas), inventory(held, person), require('./skill-steps').block(rows, attached), keepHint(rows, held)].filter(Boolean).join('\n');
}

module.exports = { block, likely, inventory, keepHint };

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
function likely(message, held) {
  const text = String(message || '').trim();
  if (!text) return '';
  const rows = [];
  if (held.has('skill')) {
    let skills = [];
    try { skills = require('../skills').list(); } catch { /* none */ }
    for (const s of best(skills, text)) rows.push(`- skill ${s.name}: ${String(s.description || '').slice(0, 160)} — \`skill\` read ${s.name}`);
  }
  if (held.has('recipe')) {
    let recipes = [];
    try { recipes = require('../../recipes/store').list().map(r => ({ name: r.id, description: `${r.title || ''}. ${r.description || ''}` })); } catch { /* none */ }
    for (const r of best(recipes, text)) rows.push(`- recipe ${r.name}: ${String(r.description).slice(0, 160)} — \`recipe\` run ${r.name}`);
  }
  return rows.length ? ['# Likely fits for this request (matched on its words; use one if it does exactly this)', ...rows].join('\n') : '';
}

/** "# What you have": keys for services and logins by name (never a secret), and how many recipes are saved. */
function inventory(held) {
  const out = [];
  if (held.has('http_fetch')) {
    try { const l = require('../../service-keys').line().trim(); if (l) out.push(`- ${l}`); } catch { /* none */ }
  }
  if (held.has('computer_login')) {
    try {
      const ls = require('../../logins').list();
      out.push(`- Logins for computer_login: ${ls.length ? ls.map(l => `${l.label} (${l.site})`).join(', ') : 'none yet — ask the owner to add one (Field → Connectors → Logins)'}.`);
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

/** The three, for one step. */
function block({ message, schemas = [], rows = [] }) {
  const held = new Set(schemas.map(s => s.function?.name || s.name));
  return [likely(message, held), inventory(held), keepHint(rows, held)].filter(Boolean).join('\n');
}

module.exports = { block, likely, inventory, keepHint };

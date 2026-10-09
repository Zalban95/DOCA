'use strict';

/**
 * Finding a setting by the words people use, and saying the one way to change it (deep test A, 2026-10-08). Read by
 * the agent's settings_read and features (toolbox/settings.js, toolbox/features.js) and by the panel's header search
 * (GET /api/settings/find), so the agent and the person are pointed at the same place.
 *
 * A result is a row of places.js — the settings people ask for by name, with their page and what to click — or a
 * declared setting the agent may propose (harness/settings.readable), placed by its prefix. Its `how` is one of:
 *   propose   settings_propose {changes, asked: true}: on the person's own turn, applied at once with a checkpoint
 *   screen    the same with screen "this": each screen keeps its own (settings-schema.js screenPropose)
 *   guarded   settings_propose makes it a proposal, accepted with the password (auth/guarded.js)
 *   password  the person's switch, with their password — the agent tells them where to click
 *   person    the person's own, on that page — nothing asks for a password, and the agent does not change it
 *   tool      a tool of its own (panel_layout)
 */
const PLACES = require('./places');

// A word people use → the words the settings are written with. Small on purpose: what is missing goes in a row's words.
const SYNONYMS = [
  ['theme', 'colour', 'color', 'colours', 'colors', 'dark', 'light', 'daylight', 'appearance', 'palette'],
  ['approval', 'approvals', 'approve', 'manual', 'auto', 'unattended', 'permission', 'confirm', 'asking'],
  ['developer', 'dev', 'experiment', 'experiments', 'experimental'],
  ['voice', 'speech', 'speak', 'tts', 'voices'],
  ['microphone', 'mic', 'listen', 'listening'],
  ['specialist', 'specialists', 'subagent', 'sub-agents', 'mission', 'missions'],
  ['model', 'llm', 'provider'],
  ['steps', 'maxsteps', 'step'],
  ['text', 'font', 'zoom', 'bigger', 'smaller'],
  ['network', 'lan', 'wifi', 'tailnet', 'tailscale', 'remote'],
  ['logs', 'retention', 'history', 'kept'],
  ['boot', 'startup', 'autostart'],
  ['budget', 'money', 'spend', 'spending', 'cost'],
];
const STOP = new Set(['the', 'and', 'for', 'turn', 'switch', 'set', 'change', 'make', 'put', 'use', 'my', 'to', 'on', 'off', 'of', 'in', 'a', 'an', 'it', 'please', 'can', 'you', 'mode', 'setting', 'settings']);

const stem = w => (w.length > 4 ? w.replace(/(ing|es|s)$/, '') : w);
function words(q) {
  const base = String(q || '').toLowerCase().split(/[^a-z0-9.+-]+/).filter(w => w.length > 1 && !STOP.has(w));
  const out = new Set(base);
  for (const w of base) for (const g of SYNONYMS) if (g.includes(w) || g.includes(stem(w))) g.forEach(x => out.add(x));
  return { base, all: [...out] };
}

const guardedOf = path => require('../auth/guarded').PREFS.find(([p]) => path === p || path.startsWith(`${p}.`) || p.startsWith(`${path}.`));

/** How one prefs path is changed: propose, screen, guarded, password or person. */
function howOf(path) {
  const settings = require('../harness/settings'), schema = require('../settings-schema');
  const top = path.split('.')[0];
  if (path.startsWith('session.')) return 'password';
  if (schema.SCHEMA[top]?.screenPropose && !schema.unproposable(path)) return 'screen';
  const proposable = settings.SETTABLE.some(s => path === s.prefix || (!s.exact && path.startsWith(`${s.prefix}.`)) || s.prefix.startsWith(`${path}.`))
    && !settings.FORBIDDEN.test(path) && !/^harness\.approval(\.|$)/.test(path) && !schema.unproposable(path);
  if (guardedOf(path)) return proposable ? 'guarded' : 'password';
  return proposable ? 'propose' : 'person';
}

// A declared setting's page, by its prefix: the longest one that matches.
const PAGE_OF = [
  ['harness.config', 'controls'], ['paths', 'settings/system'], ['computers', 'computers'], ['mcpSettings', 'mcp'],
  ['missions', 'settings/harness'], ['search', 'settings/harness'], ['thinking', 'settings/harness'], ['retrieval', 'settings/harness'],
  ['vision', 'settings/harness'], ['scout', 'settings/harness'], ['assistant', 'settings/voice'], ['voice', 'settings/voice'],
  ['call', 'settings/voice'], ['face', 'settings/voice'], ['ambient', 'settings/ambient'], ['updates', 'settings/general'],
  ['features', 'settings/system'], ['theme', 'settings/general'], ['customTheme', 'settings/general'], ['hiddenTabs', 'settings/general'],
  ['sidebarStats', 'settings/general'], ['sidebarSections', 'settings/general'], ['agents', 'harness'], ['limits', 'settings/experiments'],
  ['llamacpp', 'models'], ['services', 'settings/system'],
];
const pageOf = path => PAGE_OF.filter(([p]) => path === p || path.startsWith(`${p}.`)).sort((a, b) => b[0].length - a[0].length)[0]?.[1] || null;

/** Every row: the places, then each declared setting the agent may propose that no place already names. */
function rows() {
  const out = PLACES.map(p => ({ ...p, how: p.how || (p.paths.length ? howOf(p.paths[0]) : 'person') }));
  const named = new Set(PLACES.flatMap(p => p.paths));
  let readable = [];
  try { readable = require('../harness/settings').readable(); } catch { /* the places still answer */ }
  for (const r of readable) {
    if (named.has(r.path) || [...named].some(p => r.path.startsWith(`${p}.`))) continue;
    // Found by its path and section, not its long hint: "approval" in a hint is not the approval mode.
    out.push({ id: r.path, label: r.path, paths: [r.path], page: pageOf(r.path), how: howOf(r.path), words: r.section,
      field: `[data-leaf="${r.path}"]`, ...(r.path.startsWith('harness.config.') ? { open: 'harnessParams', field: `#hcfg-${r.path.split('.').pop()}-doca`, host: true } : {}) });
  }
  return out;
}

const hostPage = page => {
  const [top, sub] = String(page || '').split('/'), l = require('../features/pages').lists();
  return top === 'settings' && sub ? l.SUB.some(t => t.id === sub && t.host) : l.HOST_TABS.includes(top);
};

/** Settings matching `q`, best first. `host: false` leaves out the machine's (they are not that person's to find). */
function find(q, { host = true, limit = 6 } = {}) {
  const { base, all } = words(q);
  if (!base.length) return [];
  return rows().filter(r => host || (!r.host && !hostPage(r.page))).map(r => {
    const strong = `${r.id} ${r.label} ${r.paths.join(' ')}`.toLowerCase(), weak = `${r.words || ''} ${r.control || ''}`.toLowerCase();
    // The person's own words count most; a synonym's a little, so "dark" finds the theme and not every dark corner.
    const score = all.reduce((s, w) => s + (base.includes(w) ? 3 : 1) * ((strong.includes(w) ? 2 : 0) + (weak.split(/[^a-z0-9.+-]+/).includes(w) ? 1 : 0)), 0);
    return { r, score };
  }).filter(x => x.score >= 3).sort((a, b) => b.score - a.score || (a.r.paths.length ? 0 : 1)).slice(0, limit).map(x => x.r);
}

const where = r => [r.page && require('../features/pages').label(r.page), r.control].filter(Boolean).join(' → ') || 'the panel';

const hiveToo = path => require('../harness/settings').SETTABLE.some(s => path === s.prefix || (!s.exact && path.startsWith(`${s.prefix}.`)));

/** The one way to change it, said to the agent. */
function howText(r) {
  const path = r.paths[0], to = '<value>';
  const ask = `settings_propose {changes: [{path: "${path}", value: ${to}}], asked: true}`;
  switch (r.how) {
    case 'propose': return `${ask} — applied at once when the person asked for exactly this (a checkpoint keeps the old value). Or they change it in ${where(r)}.`;
    case 'screen': return `${ask.replace('{changes', '{screen: "this", changes')} — for the screen they asked from; each screen keeps its own.${
      hiveToo(path) ? ' With no screen behind the turn, leave screen out: that changes the default every screen starts from.' : ''} Or they change it in ${where(r)}.`;
    case 'guarded': return `settings_propose {changes: [{path: "${path}", value: ${to}}]} makes it a proposal they accept with their password; or they switch it themselves in ${where(r)} (it asks for their password).`;
    case 'password': return `Theirs to switch, with their password — you cannot change it. Tell them where: ${where(r)}.`;
    case 'tool': return `${r.tool}. Or they change it in ${where(r)}.`;
    default: return `Theirs to change in ${where(r)} — you do not change it; tell them where.`;
  }
}

/** One result in a few lines, for the agent. */
const describe = r => `• ${r.label}${r.paths.length ? ` (${r.paths.join(', ')})` : ''}\n  Where: ${where(r)}${r.note ? `\n  ${r.note}` : ''}\n  How: ${howText(r)}`;

function mount(app) {
  app.get('/api/settings/find', (req, res) => {
    const host = !req.auth || require('../harness/session-access').isHost(req.auth.user ? { ...req.auth.user, role: req.auth.role } : null);
    const pages = require('../features/pages');
    res.json({ results: find(String(req.query.q || '').slice(0, 200), { host, limit: 8 }).map(r => ({
      id: r.id, label: r.label, paths: r.paths, page: r.page, where: r.page ? pages.label(r.page) : '', control: r.control || '',
      card: r.card || '', field: r.field || '', open: r.open || '', how: r.how })) });
  });
}

module.exports = { find, rows, howOf, howText, describe, words, mount, SYNONYMS };

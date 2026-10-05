'use strict';

/**
 * An edition is a pack (docs/design/hive.md §6; TODO H12): beside the skills, specialists and recipes it chooses,
 * `edition.json` carries what makes a narrower DOCA feel like its own product — the names it wears (branding), how
 * every screen starts out (theme, skin, hidden tabs, sidebar sections: the hive's defaults, which each screen may
 * still change), its face, and a permission level for the people it is sold to. Built only on what exists:
 * `branding` prefs, the screen-home settings, `face`, and auth/levels.
 *
 * Importing one is the same dry run as any pack (a host's): the plan lists each part, and a level that exists here
 * is replaced only with "replace what exists". A level is created with the importer's own ceiling (levels.normalize
 * refuses rights they do not hold), so an edition can never hand out more than the person bringing it in has.
 */
const LOOK = ['theme', 'skin', 'customTheme', 'hiddenTabs', 'sidebarSections'];
const FILE = 'edition.json';

/** `sel` = { branding?: true, look?: true, face?: true, level?: levelId }: the part, or null when nothing was chosen. */
function part(sel = {}) {
  if (!sel || !(sel.branding || sel.look || sel.face || sel.level)) return null;
  const prefs = require('../utils').loadPrefs();
  const e = { format: 'doca-edition', version: 1 };
  if (sel.branding) e.branding = { ...(prefs.branding || {}) };
  if (sel.look) e.look = Object.fromEntries(LOOK.filter(k => prefs[k] !== undefined).map(k => [k, prefs[k]]));
  if (sel.face) e.face = (typeof sel.face === 'object' ? sel.face : prefs.face?.spec) || {};
  if (sel.level) {
    const l = require('../auth/levels').get(sel.level);
    if (!l) throw Object.assign(new Error(`No level "${sel.level}".`), { status: 404 });
    if (l.builtin) throw Object.assign(new Error(`${l.name} is built in: every DOCA has it already. Put a level of your own in an edition.`), { status: 400 });
    const { builtin, ...def } = l;
    e.level = def;
  }
  return { file: { name: FILE, data: `${JSON.stringify(e, null, 2)}\n` },
    content: { kind: 'edition', parts: ['branding', 'look', 'face', 'level'].filter(k => e[k] !== undefined), path: FILE } };
}

const isFile = name => name === FILE;

function item(data) {
  if (data?.format !== 'doca-edition') throw new Error('not a DOCA edition');
  return { kind: 'edition', id: data.branding?.product || data.level?.name || 'edition', data, path: FILE };
}

const exists = it => !!(it.data.level && require('../auth/levels').get(it.data.level.id));

/** What the plan shows: one line per part. */
function describe(it) {
  const d = it.data, out = [];
  if (d.branding) out.push(`names: ${Object.entries(d.branding).map(([k, v]) => `${k} "${v}"`).join(', ') || 'the defaults'}`);
  if (d.look) out.push(`look: ${Object.keys(d.look).join(', ') || 'nothing'}${d.look.hiddenTabs?.length ? ` (${d.look.hiddenTabs.length} tabs hidden)` : ''}`);
  if (d.face) out.push('a face');
  if (d.level) out.push(`level "${d.level.name}" (${(d.level.rights || []).join(', ') || 'no rights'})${exists(it) ? ' — exists here' : ''}`);
  return out.join(' · ');
}

/** Write it: prefs for names, look and face (the hive's defaults), and the level through auth/levels. */
function apply(it, { overwrite = false, actorLevel = null } = {}) {
  const d = it.data, notes = [];
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  if (d.branding && typeof d.branding === 'object') prefs.branding = Object.fromEntries(Object.entries(d.branding).filter(([k, v]) => typeof v === 'string' && k in require('../branding').DEFAULTS).map(([k, v]) => [k, v.slice(0, 80)]));
  if (d.look && typeof d.look === 'object') for (const k of LOOK) if (d.look[k] !== undefined) prefs[k] = d.look[k];
  if (d.face && typeof d.face === 'object') prefs.face = { ...(prefs.face || {}), spec: d.face };
  savePrefs(prefs);
  if (d.branding) notes.push('names');
  if (d.look) notes.push('look');
  if (d.face) notes.push('face');
  if (d.level) {
    const levels = require('../auth/levels');
    if (!actorLevel) throw Object.assign(new Error('A level is brought in by a signed-in person.'), { status: 401 });
    const have = levels.get(d.level.id);
    if (have && !overwrite) notes.push(`level "${d.level.name}" kept as it is here`);
    else if (have) { levels.update(have.id, d.level, { actorLevel }); notes.push(`level "${d.level.name}" replaced`); }
    else { const l = levels.create({ ...d.level, id: d.level.id }, { actorLevel }); notes.push(`level "${l.name}" added`); }
  }
  return notes.join(', ');
}

module.exports = { part, isFile, item, exists, describe, apply, LOOK };

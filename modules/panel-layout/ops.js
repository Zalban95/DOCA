'use strict';

/**
 * Changes a person asks for, as steps on one layer: "put Workstream first" is a move, "hide Models" a hide, "make me a
 * page with X and Y" a view, "bigger text" a style. A step works on what the person sees now (the effective layout),
 * so a move is relative to the nav on their screen, and what lower layers set is carried into this one rather than
 * lost. A step that names something that does not exist is refused with what does — never a dead end.
 */
const D = require('./defaults');
const L = require('./layout');

const bad = m => Object.assign(new Error(m), { status: 400 });
const OPS = ['move', 'group', 'hide', 'show', 'rename', 'view', 'remove_view', 'style', 'reset'];

/** Run `ops` on `layer`, given the effective layout `eff` (layout.resolve) and merged doc `merged`. */
function apply(layer, ops, { eff, merged }) {
  let doc = structuredClone(L.normalize(layer));
  const said = [];
  const pages = () => new Set([...D.PAGES, ...(doc.views || merged.views || []).map(v => v.id)]);
  const page = (t, what = 'page') => {
    const p = String(t || '').trim().toLowerCase();
    const byLabel = Object.entries(eff.labels).find(([, l]) => l.toLowerCase() === p)?.[0];
    const id = pages().has(p) ? p : byLabel || (pages().has(`view-${L.slug(p)}`) ? `view-${L.slug(p)}` : null);
    if (!id) throw bad(`No ${what} "${t}". Pages: ${[...pages()].map(x => `${x} (${eff.labels[x] || x})`).join(', ')}.`);
    return id;
  };
  // Groups as the person sees them now, written into this layer the first time a step touches them.
  let drawn = false, base = eff.groups;
  const groups = () => {
    if (!drawn) { drawn = true; doc.groups = base.map(g => ({ id: g.id, ...(D.GROUPS.some(b => b.id === g.id) ? {} : { label: g.label, icon: g.icon }), tabs: [...g.tabs] })); }
    return doc.groups;
  };
  const groupOf = t => groups().find(g => g.tabs.includes(t));
  const at = (list, item, index) => {
    const i = Number.isInteger(index) ? Math.max(0, Math.min(list.length, index < 0 ? list.length + 1 + index : index)) : list.length;
    list.splice(i, 0, item);
  };
  // A group as the person sees it, by id or by name, without writing the groups into this layer.
  const seen = id => { const k = String(id || '').trim().toLowerCase(); return eff.groups.find(g => g.id === k || g.label.toLowerCase() === k); };
  const findGroup = (id, o = {}) => {
    const key = String(id || '').trim().toLowerCase();
    const g = groups().find(x => x.id === key || (eff.groups.find(e => e.id === x.id)?.label || '').toLowerCase() === key);
    if (g || !o.make) return g;
    const made = { id: L.GROUP_ID.test(key) ? key : L.slug(key) || 'mine', label: L.label(o.label || id) || 'Mine', icon: o.icon || '★', tabs: [] };
    if (!L.GROUP_ID.test(made.id)) throw bad(`"${id}" cannot name a group.`);
    groups().splice(groups().findIndex(x => x.id === 'settings') >= 0 ? groups().findIndex(x => x.id === 'settings') : groups().length, 0, made);
    said.push(`made the group "${made.label}"`);
    return made;
  };

  for (const o of Array.isArray(ops) ? ops.slice(0, 30) : []) {
    if (!OPS.includes(o?.op)) throw bad(`Unknown step "${o?.op}". Steps: ${OPS.join(', ')}.`);
    if (o.op === 'reset') { doc = {}; merged = {}; drawn = false; base = D.GROUPS; said.push('back to the default panel'); continue; }
    if (o.op === 'move') {
      const t = page(o.page), from = groupOf(t);
      const to = o.group ? findGroup(o.group, { make: true, label: o.label, icon: o.icon }) : from;
      if (from) from.tabs.splice(from.tabs.indexOf(t), 1);
      at(to.tabs, t, o.index);
      said.push(`${eff.labels[t] || t} → ${to.label || eff.groups.find(g => g.id === to.id)?.label || to.id}${Number.isInteger(o.index) ? `, place ${o.index + 1}` : ''}`);
    } else if (o.op === 'group') {
      const known = seen(o.group);
      // Only renaming a group someone sees leaves the groups as they are; anything else writes them into this layer.
      const g = known && !Number.isInteger(o.index) && !o.icon ? known : findGroup(o.group, { make: true, label: o.label, icon: o.icon });
      if (o.label) (doc.rename ||= {})[g.id] = L.label(o.label);
      if (o.icon && /^[^<>"'&`\\\s]{1,4}$/u.test(o.icon)) g.icon = o.icon;
      if (Number.isInteger(o.index)) { const list = groups(); list.splice(list.indexOf(g), 1); at(list, g, o.index); }
      said.push(`group ${o.label || g.label || g.id}${Number.isInteger(o.index) ? ` at place ${o.index + 1}` : ''}`);
    } else if (o.op === 'hide' || o.op === 'show') {
      const t = page(o.page);
      if (t === 'settings') throw bad('Settings stays: it is the way back.');
      const h = new Set(doc.hidden || merged.hidden || []);
      if (o.op === 'hide') h.add(t); else h.delete(t);
      doc.hidden = [...h];
      said.push(`${o.op === 'hide' ? 'hid' : 'showed'} ${eff.labels[t] || t}`);
    } else if (o.op === 'rename') {
      const key = o.group ? (seen(o.group) || (doc.groups || []).find(g => g.id === o.group) || { id: null }).id : page(o.page);
      if (!key) throw bad(`No group "${o.group}". Groups: ${eff.groups.map(g => `${g.id} (${g.label})`).join(', ')}.`);
      const name = L.label(o.label);
      doc.rename ||= {};
      if (name) doc.rename[key] = name; else delete doc.rename[key];
      said.push(name ? `${key} is called "${name}"` : `${key} has its own name again`);
    } else if (o.op === 'view') {
      const list = doc.views || structuredClone(merged.views || []);
      const parts = (Array.isArray(o.pages) ? o.pages : []).map(p => ({ page: page(p) })).filter(p => !L.VIEW_ID.test(p.page));
      if (!parts.length) throw bad('A view shows one or more of the panel\'s pages: name them in pages.');
      const id = L.viewId(o.id || o.label);
      const v = { id, label: L.label(o.label) || id.slice(5), parts, columns: [1, 2, 3].includes(o.columns) ? o.columns : Math.min(parts.length, 2) };
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) list[i] = v; else list.push(v);
      doc.views = L.normalize({ views: list }).views;
      if (!doc.views.some(x => x.id === id)) throw bad(`The view "${o.label}" could not be kept.`);
      if (o.group) { const g = findGroup(o.group, { make: true, label: o.group }); const f = groupOf(id); if (f) f.tabs.splice(f.tabs.indexOf(id), 1); at(g.tabs, id, o.index); }
      else if (doc.groups && !groupOf(id)) findGroup('yours', { make: true, label: 'Yours' }).tabs.push(id);
      said.push(`${i >= 0 ? 'changed' : 'made'} the page "${v.label}" (${parts.map(p => eff.labels[p.page]).join(' + ')})`);
    } else if (o.op === 'remove_view') {
      const id = page(o.id || o.page, 'view');
      doc.views = (doc.views || merged.views || []).filter(v => v.id !== id);
      for (const g of doc.groups || []) g.tabs = g.tabs.filter(t => t !== id);
      if (doc.hidden) doc.hidden = doc.hidden.filter(t => t !== id);
      said.push(`removed the page ${eff.labels[id] || id}`);
    } else if (o.op === 'style') {
      const st = doc.style ||= {};
      if (o.fontScale !== undefined) { if (o.fontScale === null) delete st.fontScale; else st.fontScale = Number(o.fontScale); }
      if (o.density !== undefined) { if (o.density === null) delete st.density; else st.density = o.density; }
      if (o.vars && typeof o.vars === 'object') {
        st.vars ||= {};
        for (const [k, v] of Object.entries(o.vars)) { if (v === null || v === '') delete st.vars[k]; else st.vars[k] = v; }
      }
      const problems = [];
      const n = L.normalize({ style: st }, problems).style;
      if (o.fontScale != null && n.fontScale === undefined) throw bad('fontScale is between 0.75 and 1.6 (1 is today\'s size).');
      if (o.density != null && !n.density) throw bad(`density is ${D.DENSITIES.join(', ')}.`);
      if (problems.length) throw bad(`${problems.join('; ')}. Tokens: ${D.STYLE_VARS.join(', ')}.`);
      doc.style = n;
      said.push(`style: ${[n.fontScale && `text ×${n.fontScale}`, n.density, ...Object.entries(n.vars || {}).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(', ') || 'as shipped'}`);
    }
  }
  return { doc: L.normalize(doc), said };
}

module.exports = { apply, OPS };

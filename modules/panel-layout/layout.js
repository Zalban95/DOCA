'use strict';

/**
 * A panel layout is data (CONSTITUTION §0, S13; docs/design/experience.md §5): one document per layer —
 *
 *   groups  [{id, label?, icon?, tabs}]   the header's groups in order, and which pages each holds
 *   hidden  [page]                        pages left out of the nav (Settings never: it is the way back)
 *   rename  {page or group: label}        what a page or group is called
 *   views   [{id, label, parts, columns}] a person's own pages, each made of the panel's own pages ({page})
 *   style   {fontScale, density, vars}    bigger text, tighter or roomier cards, theme tokens
 *
 * Every read goes through normalize(), so a layer someone edited by hand, an older edition or a layout from another
 * install can only ever name what exists, with labels that are text and values that are colours or lengths. merge()
 * layers them (install → person → screen: lists from the top layer that has them, names and tokens key by key), and
 * resolve() turns the result into the nav the browser draws — with every page placed somewhere, so a page an update
 * adds appears even for a person whose layout predates it: updates add, they never take away.
 */
const D = require('./defaults');

const LABEL = /[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}‍️ .,:;!?()+\-_/#·★☆•]/gu;
const label = (s, n = 30) => String(s ?? '').replace(LABEL, '').replace(/\s+/g, ' ').trim().slice(0, n);
const ICON = /^[^<>"'&`\\\s]{1,4}$/u;
const VIEW_ID = /^view-[a-z0-9][a-z0-9-]{0,30}$/;
const GROUP_ID = /^[a-z][a-z0-9-]{0,30}$/;
// A token's value is a colour, a length or a font list: never a rule, a url or a way out of the declaration.
const VALUE = /^[#\w\s.,%()'"+\-/]{1,120}$/;
// Anything that fetches is refused, not only url(): image-set(), image(), cross-fade(), element() take a bare string as
// an address, and `//host/x` is one (security review 2026-10-07).
const BAD_VALUE = /url\(|image-set\(|image\(|cross-fade\(|element\(|expression|javascript:|\\|@import|\/\//i;

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 30);
const viewId = s => (String(s || '').startsWith('view-') ? String(s) : `view-${slug(s) || 'mine'}`);

function views(list, problems) {
  const out = [], seen = new Set();
  for (const v of Array.isArray(list) ? list.slice(0, 20) : []) {
    const id = viewId(v?.id || v?.label);
    if (!VIEW_ID.test(id) || seen.has(id)) { problems.push(`view "${v?.id || v?.label}" has no usable name`); continue; }
    const parts = (Array.isArray(v.parts) ? v.parts : []).map(p => (typeof p === 'string' ? { page: p } : p))
      .filter(p => D.PAGES.includes(p?.page) && p.page !== 'settings').slice(0, 6).map(p => ({ page: p.page }));
    if (!parts.length) { problems.push(`view "${id}" shows no page this panel has`); continue; }
    seen.add(id);
    out.push({ id, label: label(v.label) || id.slice(5), parts, columns: [1, 2, 3].includes(v.columns) ? v.columns : Math.min(parts.length, 2) });
  }
  return out;
}

/** A layer as it may be stored: unknown pages, groups and fields dropped, with what was dropped said. */
function normalize(doc, problems = []) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {};
  const out = {};
  if (Array.isArray(doc.views)) out.views = views(doc.views, problems);
  const known = new Set([...D.PAGES, ...(out.views || []).map(v => v.id)]);
  // A view a lower layer made is still a page here: a screen's groups may name the person's views.
  const isPage = t => known.has(t) || VIEW_ID.test(t);
  if (Array.isArray(doc.groups)) {
    const seen = new Set(), placed = new Set();
    out.groups = [];
    for (const g of doc.groups.slice(0, 20)) {
      if (!GROUP_ID.test(g?.id || '') || seen.has(g.id)) { problems.push(`group "${g?.id}" is not a usable id`); continue; }
      seen.add(g.id);
      const tabs = (Array.isArray(g.tabs) ? g.tabs : []).filter(t => { const ok = isPage(t) && !placed.has(t); if (!ok) problems.push(`"${t}" is not a page (or is placed twice)`); return ok; });
      tabs.forEach(t => placed.add(t));
      out.groups.push({ id: g.id, ...(label(g.label) ? { label: label(g.label) } : {}), ...(ICON.test(g.icon || '') ? { icon: g.icon } : {}), tabs });
    }
  }
  if (Array.isArray(doc.hidden)) out.hidden = [...new Set(doc.hidden.filter(t => t !== 'settings' && isPage(t)))];
  if (doc.rename && typeof doc.rename === 'object') {
    out.rename = {};
    for (const [k, v] of Object.entries(doc.rename).slice(0, 60)) if ((isPage(k) || GROUP_ID.test(k)) && label(v)) out.rename[k] = label(v);
  }
  if (doc.style && typeof doc.style === 'object') {
    const s = doc.style, st = {};
    const f = Number(s.fontScale);
    if (Number.isFinite(f) && f >= 0.75 && f <= 1.6) st.fontScale = Math.round(f * 100) / 100;
    if (D.DENSITIES.includes(s.density)) st.density = s.density;
    if (s.vars && typeof s.vars === 'object') {
      st.vars = {};
      for (const [k, v] of Object.entries(s.vars)) {
        if (D.STYLE_VARS.includes(k) && typeof v === 'string' && VALUE.test(v) && !BAD_VALUE.test(v)) st.vars[k] = v.trim();
        else problems.push(`style ${k} is not a theme token with a plain value`);
      }
    }
    out.style = st;
  }
  return out;
}

/** Layers bottom → top: lists from the top layer that has them, names and tokens key by key. */
function merge(layers) {
  const out = {};
  for (const l of layers.map(x => normalize(x))) {
    for (const k of ['groups', 'hidden', 'views']) if (l[k]) out[k] = l[k];
    if (l.rename) out.rename = { ...(out.rename || {}), ...l.rename };
    if (l.style) {
      const s = out.style || {};
      out.style = { ...s, ...l.style, ...(l.style.vars || s.vars ? { vars: { ...(s.vars || {}), ...(l.style.vars || {}) } } : {}) };
    }
  }
  return out;
}

/**
 * The nav to draw: groups in order with every page placed exactly once, names, what is hidden, the views and the
 * style. `host: false` leaves out the machine's pages (HOST_PAGES), in groups and inside views alike.
 */
function resolve(merged = {}, { host = true } = {}) {
  const allowed = t => host || !D.HOST_PAGES.includes(t);
  const vs = (merged.views || []).map(v => ({ ...v, parts: v.parts.filter(p => allowed(p.page)) })).filter(v => v.parts.length);
  const pages = new Set([...D.PAGES.filter(allowed), ...vs.map(v => v.id)]);
  const placed = new Set(), groups = [];
  const take = tabs => tabs.filter(t => pages.has(t) && !placed.has(t) && (placed.add(t), true));
  for (const g of merged.groups || []) {
    const base = D.GROUPS.find(x => x.id === g.id);
    groups.push({ id: g.id, label: g.label || base?.label || g.id, icon: g.icon || base?.icon || '•', tabs: take(g.tabs) });
  }
  for (const base of D.GROUPS) {
    let g = groups.find(x => x.id === base.id);
    if (!g) groups.push(g = { ...base, tabs: [] });
    g.tabs.push(...take(base.tabs));   // a page an update added lands in its own group
  }
  const loose = take(vs.map(v => v.id));
  if (loose.length) {
    const at = groups.findIndex(g => g.id === 'settings');
    groups.splice(at < 0 ? groups.length : at, 0, { id: 'yours', label: 'Yours', icon: '★', tabs: loose });
  }
  const rename = merged.rename || {};
  const labels = { ...D.LABELS, ...Object.fromEntries(vs.map(v => [v.id, v.label])) };
  for (const [k, v] of Object.entries(rename)) if (pages.has(k)) labels[k] = v;
  for (const g of groups) if (rename[g.id]) g.label = rename[g.id];
  return {
    groups: groups.filter(g => g.tabs.length),
    labels,
    hidden: (merged.hidden || []).filter(t => pages.has(t)),
    views: vs,
    style: merged.style || {},
  };
}

/** Is this layer today's panel exactly (nothing in it)? */
function isEmpty(doc) {
  return !Object.values(normalize(doc)).some(v => Array.isArray(v) || (v && Object.keys(v).length));
}

module.exports = { normalize, merge, resolve, isEmpty, label, slug, viewId, VIEW_ID, GROUP_ID };

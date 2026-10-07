'use strict';

/**
 * The panel's structure as data (TODO P1.2; CONSTITUTION §0, S1, S13; docs/design/experience.md §5). A person asking
 * to change the panel — "put Workstream first", "hide Models", "make me a page with the Workstream and the Harness",
 * "bigger text" — changes their own layer of the `panel` setting, never the code: it survives every update, follows
 * them to every device of theirs (ten users, ten panels), and a screen may override it for itself.
 *
 *   install  prefs.panel — the hive's default: what an edition brings (packs/edition.js) or an admin sets
 *   person   person-settings/<user>.settings.panel (screens.setPerson)
 *   screen   device-settings/<device>.settings.panel (screens.set)
 *
 * Every write keeps the layer it replaced (`panel-history/<scope>-<id>`, the last 20), so Undo is one click — the
 * way back S1 asks for — and a reset is a write of nothing. Whichever screens show the changed layer hear it on the
 * live feed (`screen` topic, `layout`) and draw it again.
 */
const store = require('../store');
const L = require('./layout');
const D = require('./defaults');

const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const SCOPES = ['install', 'person', 'screen'];
const HISTORY = 20;

const historyDoc = (scope, key) => `panel-history/${scope}-${key || 'hive'}`;
const keyOf = (scope, who) => (scope === 'install' ? 'hive' : scope === 'person' ? who.userId : who.deviceId);
const screens = () => require('../screens');

/** The three layers, each as stored (normalised): `who` = {userId, deviceId}. */
function layers(who = {}) {
  const prefs = require('../utils').loadPrefs();
  return {
    install: L.normalize(prefs.panel),
    person: who.userId ? L.normalize(screens().personLayer(who.userId).panel) : {},
    screen: who.deviceId ? L.normalize(screens().layer(who.deviceId).panel) : {},
  };
}

/** What this person sees on this screen: the merged layout and the nav it resolves to. */
function effective(who = {}, { host = true } = {}) {
  const l = layers(who);
  const merged = L.merge([l.install, l.person, l.screen]);
  return { layers: l, merged, resolved: L.resolve(merged, { host }) };
}

function keep(scope, who, doc) {
  const value = L.isEmpty(doc) ? null : L.normalize(doc);
  if (scope === 'install') {
    const { loadPrefs, savePrefs } = require('../utils');
    const prefs = loadPrefs();
    if (value) prefs.panel = value; else delete prefs.panel;
    savePrefs(prefs);   // a prefs checkpoint as well (checkpoints.js)
  } else if (scope === 'person') screens().setPerson(who.userId, { panel: value });
  else screens().set(who.deviceId, { panel: value });
  notify(scope, who);
  return value || {};
}

/** Replace one layer, keeping the one it replaced for Undo. */
function write(scope, who, doc) {
  if (!SCOPES.includes(scope)) throw bad(`scope is ${SCOPES.join(', ')}.`);
  if (!keyOf(scope, who)) throw bad(scope === 'screen' ? 'There is no screen to keep it for.' : 'Sign in first.', scope === 'screen' ? 400 : 401);
  const before = layers(who)[scope];
  const h = store.readJson(historyDoc(scope, keyOf(scope, who)), { items: [] });
  h.items = [...(h.items || []), { at: new Date().toISOString(), doc: before }].slice(-HISTORY);
  store.writeJson(historyDoc(scope, keyOf(scope, who)), h);
  return keep(scope, who, doc);
}

/** What the steps (ops.js) would make of one layer, without keeping it: {doc, said}. */
function plan(scope, who, ops, { host = true } = {}) {
  if (!SCOPES.includes(scope)) throw bad(`scope is ${SCOPES.join(', ')}.`);
  const { merged, resolved, layers: l } = effective(who, { host });
  return require('./ops').apply(l[scope] || {}, ops, { eff: resolved, merged });
}

/** Run the steps a person asked for on one layer, and keep it. */
function change(scope, who, ops, opts) {
  const { doc, said } = plan(scope, who, ops, opts);
  return { layout: write(scope, who, doc), said };
}

/** Put back the layer the last write replaced. */
function undo(scope, who) {
  const key = keyOf(scope, who);
  const h = store.readJson(historyDoc(scope, key), { items: [] });
  const last = (h.items || []).pop();
  if (!last) throw bad('Nothing to undo here.', 409);
  store.writeJson(historyDoc(scope, key), h);
  return keep(scope, who, last.doc);
}

const undoable = (scope, who) => (store.readJson(historyDoc(scope, keyOf(scope, who)), { items: [] }).items || []).length;

/** The screens showing a layer hear that it changed: one device, every browser of a person, or every screen. */
function notify(scope, who) {
  const live = require('../live');
  if (scope === 'screen') return live.changed('screen', who.deviceId, 'layout');
  for (const d of require('../api-v1/devices').list())
    if (!d.revokedAt && (scope === 'install' || d.userId === who.userId)) live.changed('screen', d.id, 'layout');
}

/** One line per thing the layout changes, for the agent and the card: empty when it is the shipped panel. */
function describe(doc = {}, labels = D.LABELS) {
  const n = L.normalize(doc), out = [];
  const name = t => labels[t] || t;
  if (n.groups) {
    // Only what differs from the shipped panel: the groups' order, and the groups whose pages moved.
    const gname = g => n.rename?.[g.id] || g.label || D.GROUPS.find(b => b.id === g.id)?.label || g.id;
    const order = n.groups.filter(g => D.GROUPS.some(b => b.id === g.id)).map(g => g.id);
    if (order.join() !== D.GROUPS.map(b => b.id).filter(id => order.includes(id)).join()) out.push(`groups in order: ${n.groups.map(gname).join(', ')}`);
    const moved = n.groups.filter(g => { const b = D.GROUPS.find(x => x.id === g.id); return !b || g.tabs.join() !== b.tabs.filter(t => g.tabs.includes(t) || !n.groups.some(o => o.tabs.includes(t))).join(); });
    if (moved.length) out.push(`pages: ${moved.map(g => `${gname(g)} [${g.tabs.map(name).join(', ')}]`).join(' · ')}`);
  }
  if (n.hidden?.length) out.push(`hidden: ${n.hidden.map(name).join(', ')}`);
  if (n.rename && Object.keys(n.rename).length) out.push(`renamed: ${Object.entries(n.rename).map(([k, v]) => `${k} → "${v}"`).join(', ')}`);
  if (n.views?.length) out.push(`own pages: ${n.views.map(v => `"${v.label}" (${v.parts.map(p => name(p.page)).join(' + ')})`).join(', ')}`);
  const s = n.style || {};
  if (s.fontScale || s.density || Object.keys(s.vars || {}).length) out.push(`style: ${[s.fontScale && `text ×${s.fontScale}`, s.density, ...Object.entries(s.vars || {}).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(', ')}`);
  return out;
}

module.exports = { layers, effective, plan, write, change, undo, undoable, describe, SCOPES };

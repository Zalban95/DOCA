'use strict';

/**
 * Where the licence is read structurally (index.js says what is granted):
 *
 *   ownerOf(path)   which feature a route or socket path belongs to: the most specific of the features' `routes`
 *                   patterns that matches (`*` any text, `:name` one segment); none is core
 *   prune(app)      createApp's last step: every route of an unlicensed feature is taken out of the app's router and
 *                   out of the routers mounted in it (/api/v1), so it is not there at all — the gate and
 *                   api-not-found answer 404 for it like any path the panel never had
 *   readOnly        middleware: while licensed features are read-only (index.readOnly), a request that changes
 *                   something on one of their routes is refused; reading goes on
 *   pageOn, toolOn, settingOn, flagOn   the same question for a page, a tool, a settings section, an experiment
 */
const lic = require('./index');

const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
let _pats = null;
function patterns() {
  if (!_pats) {
    // A pattern may name its method ("DELETE /api/devices/:id"); an exact path outranks a glob of the same length.
    _pats = require('../features').all().flatMap(f => f.routes.map(r => {
      const [, method, p] = /^(?:([A-Z]+) )?(.*)$/.exec(r);
      return { method: method || null, f,
        re: new RegExp(`^${esc(p).replace(/:[A-Za-z_]+/g, '[^/]+').replace(/\*/g, '.*')}$`),
        score: p.replace(/\*|:[A-Za-z_]+/g, '').length + (method ? 1 : 0) + (p.includes('*') ? 0 : 0.5) };
    })).sort((a, b) => b.score - a.score);
  }
  return _pats;
}

/** The feature a path (and method) belongs to, or null (core). */
function ownerOf(p, method = null) {
  const s = String(p || '').split('?')[0];
  const m = method && String(method).toUpperCase();
  return patterns().find(x => (!x.method || x.method === m) && x.re.test(s))?.f || null;
}
const pathOn = (p, method) => { const f = ownerOf(p, method); return !f || lic.featureOn(f); };

const mountOf = layer => (layer.regexp?.source.match(/^\^\\\/((?:[^?\\]|\\\/)+)/) || [])[1]?.replace(/\\\//g, '/') || '';

/** Take every unlicensed route out of `router` and the routers inside it. Returns what was taken out. */
function prune(router, prefix = '', out = []) {
  if (!router?.stack) return out;
  router.__licenceAll = router.__licenceAll || router.stack.slice();   // a router shared between apps (api-v1) prunes from its whole list each time
  router.stack = router.__licenceAll.filter(layer => {
    if (layer.route) {
      const paths = [].concat(layer.route.path).filter(x => typeof x === 'string').map(x => prefix + x);
      const method = Object.keys(layer.route.methods)[0];
      if (!paths.length || paths.some(p => pathOn(p, method))) return true;
      out.push(...Object.keys(layer.route.methods).map(m => `${m.toUpperCase()} ${paths[0]}`));
      return false;
    }
    if (layer.handle?.stack) prune(layer.handle, prefix + (mountOf(layer) ? `/${mountOf(layer)}` : ''), out);
    return true;
  });
  return out;
}

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Express middleware: what changes something on a licensed feature waits while the licence has lapsed. */
function readOnly(req, res, next) {
  if (READS.has(req.method) || req.path.startsWith('/api/licence')) return next();
  const f = ownerOf(req.originalUrl || req.path, req.method);
  if (!f || (f.licence || 'core') === 'core') return next();
  const why = lic.readOnly();
  if (!why) return next();
  res.status(403).json({ code: 'licence_read_only', error: why });
}

const anyOn = list => !list.length || list.some(f => lic.featureOn(f));
const all = () => require('../features').all();

/** A page (a nav.js id, or settings/<sub-tab>) is drawn while any feature on it is licensed. */
const pageOn = page => anyOn(all().filter(f => f.page.includes(page)));
/** A built-in tool is offered while any feature that lists it is licensed. */
const toolOn = name => anyOn(all().filter(f => f.tools.includes(name)));
/** A settings section (its top-level key) is offered to the agent while any feature naming a setting in it is licensed. */
const settingOn = dotted => { const top = String(dotted).split('.')[0]; return anyOn(all().filter(f => f.settings.some(s => s.split('.')[0] === top))); };
/** An experiment can be on only while its feature is licensed. */
const flagOn = id => anyOn(all().filter(f => f.flag === id));

/** Everything unlicensed, by kind, for the panel (/api/licence) and the agent. */
function off() {
  const fs = all().filter(f => !lic.featureOn(f));
  const pages = [...new Set(all().flatMap(f => f.page))].filter(p => !pageOn(p));
  return { features: fs.map(f => f.id), pages, tools: [...new Set(fs.flatMap(f => f.tools))].filter(t => !toolOn(t)) };
}

/** createApp's last step: the licence's own routes, then every unlicensed route taken out. */
function mount(app) {
  require('./routes').mount(app);
  prune(app._router);
}

module.exports = { mount, ownerOf, pathOn, prune, readOnly, pageOn, toolOn, settingOn, flagOn, off, _reset: () => { _pats = null; } };

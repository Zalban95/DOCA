'use strict';

/**
 * A licensed feature's routes leave the app when it is not licensed (modules/license/gate.js prune), and only its own:
 * a pattern broader than its routes takes the core's with it. Found by a newcomer on a core-only install (2026-10-14):
 * `harness-teams` claimed `/api/projects/*`, so a project could be made and never opened ("There is no GET
 * /api/projects/prj_… in this panel"). Here, with no licence, every route a core feature's pattern names is still
 * mounted — unless a licensed feature claims it by a narrower pattern, one with a literal segment of its own past where
 * the core's pattern stops being literal (`/api/projects/:id/team-branches*` inside `/api/projects*`).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test key

const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const files = () => require('../modules/license/files');

const esc = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const parse = r => { const [, method, p] = /^(?:([A-Z]+) )?(.*)$/.exec(r); return { method: method || null, p,
  re: new RegExp(`^${esc(p).replace(/:[A-Za-z_]+/g, '[^/]+').replace(/\*/g, '.*')}$`) }; };
const matches = (pat, route) => (!pat.method || pat.method === route.method) && pat.re.test(route.path);
/** A licensed pattern is narrower than a core one when, past the core pattern's literal text (what comes before its
 *  first `*` or `:`), it names a literal segment of its own: `/api/projects/:id/team-branches*` is, `/api/projects/*` is not. */
function narrower(licensed, core) {
  const lit = core.split(/[*:]/)[0];
  if (!licensed.startsWith(lit)) return true;   // not inside the core's text: the glob only touches it by its wildcard
  return licensed.slice(lit.length).split('/').slice(1).some(x => !x.startsWith(':') && x.replace(/\*.*$/, '') !== '');
}

/** Every route the app has, licensed or not ({method, path}), from the lists gate.prune keeps beside each router. */
function allRoutes(router, prefix = '', out = []) {
  for (const layer of router.__licenceAll || router.stack || []) {
    if (layer.route) {
      for (const p of [].concat(layer.route.path).filter(x => typeof x === 'string'))
        for (const m of Object.keys(layer.route.methods)) out.push({ method: m.toUpperCase(), path: prefix + p, layer });
    } else if (layer.handle?.stack) {
      const mount = (layer.regexp?.source.match(/^\^\\\/((?:[^?\\]|\\\/)+)/) || [])[1]?.replace(/\\\//g, '/') || '';
      allRoutes(layer.handle, prefix + (mount ? `/${mount}` : ''), out);
    }
  }
  return out;
}
/** The layers still mounted after pruning. */
function mounted(router, out = new Set()) {
  for (const layer of router.stack || []) { if (layer.route) out.add(layer); else if (layer.handle?.stack) mounted(layer.handle, out); }
  return out;
}

test.before(() => H.start());
test.after(() => H.stop());

test('with no licence, every route of a core feature is still mounted', async () => {
  const was = keys().preloaded.certificate;
  keys().preloaded.certificate = null;
  files().remove(files().LICENCE);
  lic().reload();
  try {
    assert.equal(lic().status().source, 'none');
    const app = require('../server').createApp();
    const routes = allRoutes(app._router);
    assert.ok(routes.length > 300, 'the walk found the routes');
    const live = mounted(app._router);
    const features = require('../modules/features').all();
    const core = features.filter(f => (f.licence || 'core') === 'core');
    const gate = require('../modules/license/gate');
    const lost = [];
    for (const r of routes) {
      const claims = core.flatMap(f => f.routes.map(parse).filter(pat => matches(pat, r)).map(pat => ({ f, pat })));
      if (!claims.length || live.has(r.layer)) continue;
      const owner = gate.ownerOf(r.path, r.method);
      const ownPat = owner && owner.routes.map(parse).find(pat => matches(pat, r));
      if (ownPat && claims.every(c => narrower(ownPat.p, c.pat.p))) continue;
      lost.push(`${r.method} ${r.path} — core ${claims.map(c => c.f.id).join(', ')}, taken out by ${owner?.id} (${ownPat?.p})`);
    }
    assert.deepEqual(lost, [], 'a licensed feature claims a core route with a pattern broader than its own routes');

    // The newcomer's walk: a project opens on the core, and the licensed team branches are not there.
    const own = r => gate.ownerOf(r, 'GET');
    assert.equal(own('/api/projects/prj_x').id, 'projects');
    assert.equal(own('/api/projects/prj_x/tree').id, 'projects');
    assert.equal(own('/api/projects/prj_x/team-branches').id, 'harness-teams');
    assert.ok(routes.some(r => r.path === '/api/projects/:id' && r.method === 'GET' && live.has(r.layer)), 'GET /api/projects/:id is mounted');
    assert.ok(!routes.some(r => r.path.startsWith('/api/projects/:id/team-branches') && live.has(r.layer)), 'the team branches are not');
  } finally {
    keys().preloaded.certificate = was;
    lic().reload();
  }
});

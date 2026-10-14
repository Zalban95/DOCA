'use strict';

/**
 * A hive running the core only (no licence) never shows a control whose route is not there, nor sends a person to a
 * page it does not have (public/js/lib/licence.js: "left out, never drawn as refusals"). Found by a newcomer's run on a
 * fresh install (2026-10-14): Packs offered to add a hub, General offered Computers, Docker and VMs, "Models in use"
 * named Settings → Voice, and the text named Field → Connectors and Live. Each is checked with the core only and with
 * the full licence the suite runs under.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const H = require('./helpers');   // first: it points the settings at a temporary folder, and trusts the test key
const F = require('./frontend');

const lic = () => require('../modules/license');
const keys = () => require('../modules/license/keys');
const files = () => require('../modules/license/files');

/** Run `fn` with no licence at all, as a fresh install's next start reads it; the suite's licence comes back after. */
async function coreOnly(fn) {
  const was = keys().preloaded.certificate;
  keys().preloaded.certificate = null;
  files().remove(files().LICENCE);
  lic().reload();
  try { return await fn(); } finally {
    files().remove(files().STATE); files().remove(files().GRACE);
    keys().preloaded.certificate = was;
    lic().reload();
  }
}

/** What GET /api/licence says is off, read the way the panel reads it. */
const offNow = () => { const o = require('../modules/license/gate').off(); return { pages: o.pages, features: o.features }; };

/** A sandbox holding the panel's licence reader, the HTML helpers and `names` (top-level functions), with LICENCE set. */
function panel(names, off, extra = {}) {
  const ctx = vm.createContext({ console, infoBtn: () => '', document: { getElementById: () => null, querySelectorAll: () => [] }, ...extra });
  vm.runInContext(F.source('lib/html.js', 'lib/licence.js'), ctx);
  vm.runInContext(`LICENCE = ${JSON.stringify({ off, banner: null })}; licenceReady = async () => LICENCE;`, ctx);
  for (const n of names) vm.runInContext(F.fn(n), ctx);
  return ctx;
}

test.before(() => H.start());
test.after(() => H.stop());

test('the core only: the license reports what the panel leaves out', async () => {
  await coreOnly(() => {
    const off = offNow();
    for (const f of ['pack-hubs', 'pack-registry', 'sharing', 'connectors', 'voice', 'machines-live']) assert.ok(off.features.includes(f), f);
    for (const p of ['computers', 'docker', 'vms', 'connectors', 'live', 'settings/voice']) assert.ok(off.pages.includes(p), p);
  });
  const full = offNow();
  assert.ok(!full.features.includes('pack-hubs') && !full.pages.includes('computers'));
});

test('Settings → Packs: other hubs, Send and Add are left out unless pack-hubs is licensed', async () => {
  const library = { packs: [{ id: 'p1', name: 'one', origin: 'here', savedAt: '2026-10-14T00:00:00Z', contents: [] }], hubs: [{ id: 'h1', label: 'Other', url: 'https://other:4242', send: true, read: true }], registry: true };
  const draw = async off => {
    const el = { innerHTML: '' };
    const ctx = panel(['packsLibraryRender'], off, { apiFetch: async () => library });
    ctx.document.getElementById = id => (id === 'pack-library' ? el : null);
    await vm.runInContext('packsLibraryRender()', ctx);
    return el.innerHTML;
  };
  const core = await coreOnly(async () => draw(offNow()));
  assert.doesNotMatch(core, /Other hubs to send to|packsHubAdd|Send to…|Publish|Browse/);
  assert.match(core, /Bring in…/, 'the library itself stays');
  const full = await draw(offNow());
  assert.match(full, /Other hubs to send to/); assert.match(full, /packsHubAdd/); assert.match(full, /Send to…/);
});

test('pages the hive does not have are absent from every list of pages: the layout, its refusals, General, the search', async () => {
  const layout = async () => (await H.api(null, 'GET', '/api/screen/layout')).body.resolved;
  const refusal = async () => (await H.api(null, 'POST', '/api/screen/layout', { scope: 'person', ops: [{ op: 'hide', page: 'nothing-here' }] })).body;
  const general = off => {
    const el = { innerHTML: '' };
    const ctx = panel([], off, { advancedFold: h => h });
    vm.runInContext(F.read('settings.js'), ctx);
    ctx.document.getElementById = id => (id === 'settings-tabs-list' ? el : null);
    vm.runInContext('_settingsRender()', ctx);
    return el.innerHTML;
  };
  const search = off => {
    const ctx = panel(['globalSearchPlaces'], off, { nav: () => {}, settingsSubNav: () => {} });
    vm.runInContext(F.read('settings/subnav.js').match(/const _SETTINGS_SUBTABS = \[[\s\S]*?\n\];/)[0], ctx);
    return vm.runInContext('globalSearchPlaces("")', ctx).map(p => p.label);
  };
  await coreOnly(async () => {
    const r = await layout(), off = offNow();
    for (const p of ['computers', 'docker', 'vms', 'live', 'connectors']) assert.ok(r.absent.includes(p), `${p} is absent`);
    const said = await refusal();
    assert.match(said.error, /No page "nothing-here"/);
    assert.doesNotMatch(said.error, /computers \(|docker \(|vms \(/, 'a refusal lists only the pages this hive has');
    const g = general(off);
    assert.match(g, /Projects/); assert.doesNotMatch(g, /Computers|Docker|VMs/);
    const s = search(off);
    assert.ok(s.includes('General') && !s.includes('Voice') && !s.includes('Connectors'), s.join());
  });
  assert.ok(!(await layout()).absent, 'the full licence leaves nothing absent');
  assert.match(general(offNow()), /Computers[\s\S]*Docker[\s\S]*VMs/);
  const s = search(offNow());
  assert.ok(s.includes('Voice') && s.includes('Connectors'), s.join());
});

test('"Models in use" names only roles and places this hive has', async () => {
  const roles = async () => (await H.api(null, 'GET', '/api/models/roles')).body.roles;
  const missing = /Settings → Voice|Agents → Harness → Specialists|Settings → Harness → Vision|Wake words|Library|Decision models|Retrieval/;
  await coreOnly(async () => {
    const r = await roles();
    assert.ok(r.some(x => x.id === 'harness') && r.some(x => x.id === 'stt'), 'the core\'s roles stay');
    for (const x of r) assert.doesNotMatch(x.where, missing, `${x.id}: ${x.where}`);
    assert.equal(r.find(x => x.id === 'stt').where, 'Field → Models → Inference Services (Whisper)');
    assert.ok(!r.some(x => ['assistant', 'specialists', 'vision', 'wakeword', 'library'].includes(x.id)));
  });
  const r = await roles();
  assert.ok(['assistant', 'specialists', 'vision', 'wakeword', 'library'].every(id => r.some(x => x.id === id)));
  assert.match(r.find(x => x.id === 'stt').where, /^Settings → Voice; /);
});

test('words written for every hive name no page this one lacks: the MCP catalogue, the agent\'s readings, the notes', async () => {
  const said = () => {
    const ha = require('../modules/mcp/catalog').list().find(c => c.id === 'home-assistant').about;
    const secret = require('../modules/secret-scan').sentence([{ file: 'a.txt', line: 1, kind: 'bearer' }]);
    const why = require('../modules/harness/turn/tool-shape').switches().filter(o => o.name === 'vnc_look').map(o => o.why);
    const cast = require('../modules/settings-find').find('cast to tv speakers nearby').map(r => r.page);
    const note = require('../modules/guided/pick').pickRole('stt', { gpus: [], ramGB: 4, diskGB: 10 }, require('../modules/guided/suggested-models.json')).providersNote;
    const keyParam = require('../modules/harness/tools').TOOLS.find(t => t.name === 'api_call').parameters.properties.key.description;
    return { ha, secret, why, cast, note, keyParam };
  };
  await coreOnly(() => {
    const s = said();
    assert.doesNotMatch(s.ha, /Field → Connectors/); assert.match(s.ha, /Authorization: Bearer/);
    assert.doesNotMatch(s.secret, /Field → Connectors/); assert.match(s.secret, /Take it out and try again/);
    assert.equal(s.why.length, 1); assert.match(s.why[0], /not in this hive's licence/, 'one reason, never Machines → VNC');
    assert.ok(!s.cast.includes('nearby'), 'a setting on a page the hive lacks is not found');
    if (s.note) assert.doesNotMatch(s.note, /Settings → Voice/);
    assert.doesNotMatch(s.keyParam, /Field → Connectors/);
  });
  const s = said();
  assert.match(s.ha, /Field → Connectors → Keys for services/);
  assert.match(s.secret, /Field → Connectors → Keys for services/);
  assert.match(s.keyParam, /Field → Connectors/);
  if (s.note) assert.match(s.note, /Settings → Voice/);
});

test('the MCP page: no token field, note or step sends a core-only hive to Connectors', async () => {
  const run = off => {
    const ctx = panel(['mcpKeyNoteHtml'], off, { appLinkHtml: () => '' });
    vm.runInContext(F.read('lib/app-links.js'), ctx);
    vm.runInContext(F.read('mcp-key.js'), ctx);
    const note = vm.runInContext('mcpKeyNoteHtml({ key: "home-assistant", url: "http://ha.local:8123/api/mcp" })', ctx);
    const steps = vm.runInContext('APP_LINKS["home-assistant"].flows.mcp.join(" ")', ctx);
    let fetched = 0;
    ctx.apiFetch = async () => { fetched++; return { keys: [] }; };
    ctx.document.createElement = () => ({});
    return vm.runInContext('mcpKeyField("home-assistant")', ctx).then(() => ({ note, steps, fetched, keep: vm.runInContext('_mcpKeyName', ctx) }));
  };
  const core = await coreOnly(async () => run(offNow()));
  assert.doesNotMatch(core.note + core.steps, /Field → Connectors/);
  assert.match(core.steps, /Authorization: Bearer/);
  assert.equal(core.fetched, 0, 'no call to keys for services, which are not here');
  assert.equal(core.keep, null, 'nothing to keep a token as');
  const full = await run(offNow());
  assert.match(full.note, /Field → Connectors → API services/);
  assert.match(full.steps, /Field → Connectors/);
  assert.equal(full.fetched, 1); assert.equal(full.keep, 'home-assistant');
});

test('Hub → Logs → Machines says what looks at the machines without naming Live where there is none', async () => {
  const first = () => { let t = ''; const stop = require('../modules/machines/busy-log').open(1, l => { t ||= l.text; }); stop(); return t; };
  if (require('../modules/machines/busy-log').lines().length) return;   // something seen already: no first line to read
  await coreOnly(() => {
    const t = first();
    assert.doesNotMatch(t, /Live|status column/); assert.match(t, /the Workstream is shown/);
  });
  assert.match(first(), /while Live, the Workstream or the status column is shown/);
});

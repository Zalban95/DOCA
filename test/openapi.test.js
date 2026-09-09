'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const openapi = require('../modules/api-v1/openapi');
const { router } = require('../modules/api-v1/router');
const bus = require('../modules/api-v1/bus');
const commands = require('../modules/api-v1/commands');

before(async () => { await H.start(); });
after(async () => { await H.stop(); });

/** Walk an Express 4 router and return every `METHOD /path` it serves (OpenAPI-style `{param}` placeholders). */
function expressRoutes(r, prefix = '') {
  const out = new Set();
  for (const layer of r.stack) {
    if (layer.route) {
      for (const m of Object.keys(layer.route.methods)) out.add(`${m.toUpperCase()} ${prefix}${layer.route.path}`.replace(/:(\w+)/g, '{$1}'));
    } else if (layer.name === 'router' && layer.handle?.stack) {
      // Express stores the mount path as a regexp such as /^\/agent\/?(?=\/|$)/i
      const m = /^\^\\\/(.+?)\\\/\?\(\?=/.exec(layer.regexp.source);
      for (const x of expressRoutes(layer.handle, `${prefix}/${m ? m[1].replace(/\\\//g, '/') : ''}`)) out.add(x);
    }
  }
  return out;
}

function specRoutes(doc) {
  const out = new Set();
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) if (item[m]) out.add(`${m.toUpperCase()} ${p}`);
  }
  return out;
}

test('every Express route under /api/v1 is described in the OpenAPI document, and vice versa', () => {
  const fromCode = expressRoutes(router);
  const fromSpec = specRoutes(openapi.build());
  const missing = [...fromCode].filter(x => !fromSpec.has(x)).sort();
  const stale = [...fromSpec].filter(x => !fromCode.has(x)).sort();
  assert.deepEqual(missing, [], `routes served but undocumented: ${missing.join(', ')}`);
  assert.deepEqual(stale, [], `documented but not served: ${stale.join(', ')}`);
  assert.ok(fromCode.size >= 50, `expected a substantial API surface, found ${fromCode.size} routes`);
});

test('the checked-in docs/api/openapi.json matches the generator (run `npm run openapi > docs/api/openapi.json`)', () => {
  const checkedIn = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'openapi.json'), 'utf8'));
  assert.deepEqual(checkedIn, JSON.parse(JSON.stringify(openapi.build())));
});

test('enumerations in the document are derived from the live registries', () => {
  const doc = openapi.build();
  assert.deepEqual(Object.keys(doc['x-events']).sort(), Object.keys(bus.TYPES).sort());
  for (const [type, def] of Object.entries(bus.TYPES)) assert.equal(doc['x-events'][type].class, def.cls);
  assert.deepEqual(doc.components.schemas.Command.properties.id.enum, commands.ids());
  assert.deepEqual(doc.paths['/commands/{id}'].parameters[0].schema.enum, commands.ids());
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[m]; if (!op) continue;
      assert.ok(op.operationId, `${m} ${p} needs an operationId`);
      assert.ok(op.tags?.length, `${m} ${p} needs a tag`);
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      if (!isPublic) assert.ok(op.responses['401'], `${m} ${p} is authenticated and must document 401`);
    }
  }
  const ids = Object.values(doc.paths).flatMap(i => Object.values(i).map(o => o.operationId).filter(Boolean));
  assert.equal(new Set(ids).size, ids.length, 'operationIds must be unique');
});

test('GET /api/v1/openapi.json is public and discovery points at it', async () => {
  const disc = await H.api(null, 'GET', '/api/v1/');
  assert.equal(disc.status, 200);
  assert.equal(disc.body.openapiUrl, '/api/v1/openapi.json');
  const r = await H.api(null, 'GET', '/api/v1/openapi.json');
  assert.equal(r.status, 200);
  assert.equal(r.body.openapi, '3.1.0');
  assert.equal(r.body.info.version, disc.body.protocol.version);
  assert.ok(r.body.paths['/capabilities'].get);
  assert.equal(r.body.paths['/openapi.json'].get.security.length, 0);
});

'use strict';

/**
 * API services as OpenAPI (modules/api-services/): a provider's document read in — YAML or JSON, OpenAPI 3 or Swagger 2 —
 * written back out unchanged, found from a link, carried in a pack without its key, drafted by the agent and saved by a
 * person; and the guards: a key only for its own origin, no keyless stranger, no parameter that sets the key's header.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const H = require('./helpers');   // first: it points the settings at a temporary folder

const openapi = () => require('../modules/api-services/openapi');
const store = () => require('../modules/api-services/store');
const yaml = () => require('../modules/api-services/yaml');

// The shape providers publish: shared parameters, $refs into components, allOf, a multipart upload, a block scalar.
const SPEC = `openapi: 3.0.3
info:
  title: Meshes API   # a comment
  description: >-
    Makes meshes
    from pictures.
servers:
  - url: https://api.meshes.example/{version}
    variables:
      version:
        default: v2
components:
  securitySchemes:
    ApiKeyAuth: {type: apiKey, in: header, name: X-API-Key}
  parameters:
    Limit:
      name: limit
      in: query
      schema: {type: integer, default: 20}
  schemas:
    Base:
      type: object
      required: [prompt]
      properties:
        prompt: {type: string, description: "What to make"}
    Job:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          properties:
            style: {type: string, enum: [clay, real]}
security:
  - ApiKeyAuth: []
paths:
  /jobs:
    get:
      operationId: listJobs
      parameters:
        - $ref: '#/components/parameters/Limit'
    post:
      operationId: createJob
      summary: |
        Start a mesh.
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              allOf:
                - $ref: '#/components/schemas/Job'
                - properties:
                    image: {type: string, format: binary}
  /jobs/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema: {type: string}
    get:
      operationId: getJob
`;

let srv, base;
test.before(async () => {
  await H.start();
  srv = http.createServer((req, res) => {
    if (req.url === '/openapi.yaml') { res.setHeader('Content-Type', 'application/yaml'); return res.end(SPEC.replace('https://api.meshes.example/{version}', `http://127.0.0.1:${srv.address().port}/{version}`)); }
    if (req.url === '/docs') { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body>Our API</body></html>'); }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => { srv.close(); await H.stop(); });

test('a YAML document as providers write it is read: servers, the key, every action with its parameters and body', () => {
  const doc = yaml().read(SPEC);
  assert.equal(doc.info.description, 'Makes meshes from pictures.');
  const { definition: d, warnings } = openapi().fromDoc(doc);
  assert.deepEqual(warnings, []);
  assert.equal(d.server, 'https://api.meshes.example/v2');
  assert.deepEqual(d.auth, { type: 'apiKey', in: 'header', name: 'X-API-Key' });
  assert.deepEqual(d.actions.map(a => `${a.method} ${a.name}`), ['GET listJobs', 'POST createJob', 'GET getJob']);
  assert.deepEqual(d.actions[0].params, [{ name: 'limit', type: 'integer', default: 20, in: 'query' }]);
  assert.equal(d.actions[1].summary, 'Start a mesh.');
  assert.deepEqual(d.actions[1].body.fields.map(f => `${f.name}${f.required ? '*' : ''}${f.file ? ' file' : ''}`), ['prompt*', 'style', 'image file']);
  assert.deepEqual(d.actions[2].params[0], { name: 'id', type: 'string', required: true, in: 'path' });
  // The same document as JSON reads the same.
  assert.deepEqual(openapi().fromDoc(yaml().read(JSON.stringify(doc))).definition, d);
});

test('Swagger 2.0 reads too, and a definition goes out as OpenAPI 3.1 and comes back unchanged', () => {
  const v2 = { swagger: '2.0', host: 'api.old.example', basePath: '/v1', schemes: ['https'], securityDefinitions: { k: { type: 'apiKey', in: 'query', name: 'key' } },
    paths: { '/upload': { post: { operationId: 'upload', consumes: ['multipart/form-data'], parameters: [{ name: 'file', in: 'formData', type: 'file', required: true }, { name: 'tag', in: 'formData', type: 'string' }] } } } };
  const d2 = openapi().fromDoc(v2).definition;
  assert.equal(d2.server, 'https://api.old.example/v1');
  assert.deepEqual(d2.auth, { type: 'apiKey', in: 'query', name: 'key' });
  assert.equal(d2.actions[0].body.kind, 'multipart');
  const hi3d = require('../modules/api-services/templates').load('hi3d').definition;
  assert.equal(hi3d.actions[0].job.poll.operation, 'queryTask');
  assert.deepEqual(hi3d.auth, { type: 'oauth2', tokenUrl: 'https://api.hitem3d.ai/open-api/v1/auth/token', tokenBody: 'json' });
  for (const d of [d2, hi3d, openapi().fromDoc(yaml().read(SPEC)).definition]) {
    const out = openapi().toDoc({ ...d, name: d.name || 'x' });
    assert.equal(out.openapi, '3.1.0');
    const back = openapi().fromDoc(JSON.parse(JSON.stringify(out))).definition;
    assert.deepEqual({ ...back, name: undefined, title: undefined, source: undefined }, { ...d, name: undefined, title: undefined, source: undefined });
  }
});

test('the key goes only to its own origin: the store refuses what would send it elsewhere', async () => {
  const keys = require('../modules/service-keys');
  keys.save({ name: 'meshes', origin: 'https://api.meshes.example', key: 'k-abcdef' });
  const d = { name: 'meshes', ...openapi().fromDoc(yaml().read(SPEC)).definition };
  assert.equal(store().save(d).hasKey, true);
  assert.throws(() => store().save({ ...d, server: 'https://evil.example/v2' }), /sent only to https:\/\/api\.meshes\.example/);
  assert.throws(() => store().check({ ...d, name: 'x1', auth: { type: 'oauth2', tokenUrl: 'https://evil.example/token' } }), /token address is on the service's own address/);
  assert.throws(() => store().check({ ...d, name: 'x2', auth: { type: 'none' } }), /must be one of your own addresses/);
  assert.ok(store().check({ ...d, name: 'x3', server: 'http://127.0.0.1:9/v1', auth: { type: 'none' } }));
  const build = require('../modules/api-services/call').build;
  const def = store().get('meshes');
  assert.throws(() => build(def, { ...def.actions[0], params: [{ name: 'X-API-Key', in: 'header' }] }, { 'X-API-Key': 'stolen' }), /set by the hub/);
  assert.equal(build(def, def.actions[2], { id: '../../x' }).url, 'https://api.meshes.example/v2/jobs/..%2F..%2Fx');
  // The agent has no way to change one: the tool's actions are list, describe and call.
  assert.match(await require('../modules/harness/tools').call('service', { action: 'save', service: 'meshes' }, [], {}), /^Error: action is list, describe or call/);
});

test('a name offers the ready-made; a docs link finds the document where specs are published', async () => {
  let r = await H.api(null, 'POST', '/api/connectors/services/find', { q: 'hi3d' });
  assert.deepEqual(r.body.templates.map(t => t.id), ['hi3d']);
  r = await H.api(null, 'POST', '/api/connectors/services/find', { q: `${base}/docs` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.found, `${base}/openapi.yaml`);
  assert.equal(r.body.definition.server, `${base}/v2`);
  assert.equal(r.body.openapi.paths['/jobs'].post.operationId, 'createJob');
  r = await H.api(null, 'POST', '/api/connectors/services/find', { q: `${base}/nothing-here` });
  assert.equal(r.body.found, `${base}/openapi.yaml`, 'the origin\'s usual places are tried');
});

test('a pack carries the service as OpenAPI without its key, and brings it back keyless', async () => {
  const { buffer, manifest } = require('../modules/packs/export').build({ name: 'p', services: ['meshes'] });
  assert.deepEqual(manifest.needs.secrets, ['service.meshes.key']);
  const files = require('../modules/packs/zip').read(buffer);
  const f = files.find(x => x.name === 'services/meshes.openapi.json');
  assert.ok(f);
  assert.equal(f.data.toString().includes('k-abcdef'), false);
  store().remove('meshes'); require('../modules/service-keys').remove('meshes');
  const plan = require('../modules/packs/import').plan(buffer);
  assert.deepEqual(plan.items.map(i => [i.key, i.overwrites, i.actions]), [['service:meshes', false, 3]]);
  const done = require('../modules/packs/import').apply(buffer).done;
  assert.match(done[0].note, /paste its key/);
  assert.equal(store().view('meshes').needsKey, true);
});

test('the agent drafts a service with its actions and a skill; the person\'s Save keeps both, linked', async () => {
  const tools = require('../modules/harness/tools');
  const out = await tools.call('service_draft', { name: 'pics', origin: 'https://api.pics.example', note: 'Pictures', openapi: { paths: { '/p': { get: { operationId: 'listPics' } } } },
    skill: { name: 'pics-use', description: 'Pictures.', body: '1. Ask for pictures.' } }, [], { sessionId: 's1' });
  assert.match(out, /Prepared "pics" .*1 actions with the skill "pics-use"/);
  assert.equal(store().get('pics'), null, 'nothing until a person saves');
  const d = (await H.api(null, 'GET', '/api/connectors/drafts/all')).body.drafts.find(x => x.name === 'pics');
  assert.equal(d.openapi.paths['/p'].get.operationId, 'listPics');
  const r = await H.api(null, 'POST', '/api/connectors/services/all', { draft: d.id, name: 'pics', server: 'https://api.pics.example', key: 'pk-123456',
    auth: { type: 'bearer' }, openapi: JSON.stringify(d.openapi), skill: 'pics-use' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(store().view('pics').skill, 'pics-use');
  assert.deepEqual(store().view('pics').actions.map(a => a.name), ['listPics']);
  assert.match(require('../modules/harness/skills').read('pics-use').body, /API services for this skill .*\n- pics: listPics/s);
  assert.equal((await H.api(null, 'GET', '/api/services/nothing')).status, 404);
});

test('without a service the tool is not offered, and says where they are set up', () => {
  const shape = require('../modules/harness/turn/tool-shape');
  for (const s of store().list()) { store().remove(s.name); try { require('../modules/service-keys').remove(s.name); } catch { /* none */ } }
  assert.ok(shape.switches().some(x => x.name === 'service' && /Field → Connectors → API services/.test(x.why)));
});

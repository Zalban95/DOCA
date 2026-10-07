'use strict';

/** A service the agent prepared (modules/service-drafts.js): everything but the secret, and a skill, saved by a person. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const tools = require('../modules/harness/tools');

test.before(() => H.start());
test.after(() => H.stop());

test('the agent drafts the key and the skill; nothing works until a person pastes the key and saves', async () => {
  const out = await tools.call('service_draft', { name: 'weather', origin: 'https://api.weather.example/v1/', place: 'query', field: 'appid',
    note: 'Forecasts by city', docs: 'https://weather.example/docs',
    skill: { name: 'weather-forecast', description: 'Tomorrow\'s weather for a city.', body: '1. `http_fetch {url: "https://api.weather.example/v1/forecast?q=<city>", key: "weather"}`' } }, [], { sessionId: 's1' });
  assert.match(out, /Prepared "weather".*with the skill "weather-forecast"/);
  assert.match(await tools.call('api_call', { url: 'https://api.weather.example/v1/x', key: 'weather' }, [], {}), /No key named "weather"/, 'not usable as a draft');
  const d = (await H.api(null, 'GET', '/api/connectors/drafts/all')).body.drafts;
  assert.equal(d.length, 1); assert.equal(d[0].origin, 'https://api.weather.example');
  assert.equal((await H.api(null, 'POST', `/api/connectors/drafts/${d[0].id}/accept`, { key: '' })).status, 400, 'a key is needed');
  const r = await H.api(null, 'POST', `/api/connectors/drafts/${d[0].id}/accept`, { key: 'k-123456' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.skill, 'weather-forecast');
  assert.ok((await H.api(null, 'GET', '/api/connectors/keys/all')).body.keys.some(k => k.name === 'weather' && k.place === 'query' && k.field === 'appid'));
  assert.ok(require('../modules/harness/skills').list().some(s => s.name === 'weather-forecast'));
  assert.equal((await H.api(null, 'GET', '/api/connectors/drafts/all')).body.drafts.length, 0);
  assert.ok(require('../modules/agents/registry').NEVER.includes('service_draft'));
  assert.match(await tools.call('service_draft', { name: 'Bad Name', origin: 'x', note: 'n' }, [], {}), /^Error: name/);
});

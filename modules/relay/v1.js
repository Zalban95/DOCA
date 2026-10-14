'use strict';

/**
 * The model relay for paired devices (relay/device.js; the scope `relay:use`, the owner's yes of 2026-10-14):
 * `/api/v1/relay` is an OpenAI base URL — `GET /models`, `POST /chat/completions`, streamed or not — answered with the
 * device's own bearer token over the panel's HTTPS, never the computers' listener. The request is the relay's
 * (serve.js): the hub's provider and key, the device's person's models, budget and level, a usage row tagged
 * `relay:device:<id>`. Refusals are OpenAI's error shape, so an SDK says them in its own words.
 */
const { requireScope } = require('../api-v1/auth');

function mount(router) {
  const serve = () => require('./serve');
  router.get('/relay/models', requireScope('relay:use'), (req, res) => serve().handleDevice(req, res, 'models'));
  router.post('/relay/chat/completions', requireScope('relay:use'), (req, res) => serve().handleDevice(req, res, 'chat'));
}

function openapi({ obj, str, arr, json, std }) {
  const error = obj({ error: obj({ message: str(), type: str(), code: str({ description: 'invalid_api_key, relay_off, model_not_found, budget_reached, …' }) }) });
  const refusals = { 403: json(error, 'The relay is off for devices, this device\'s own switch is off, or the scope is missing.'), 429: json(error, 'The person\'s budget is reached.') };
  return {
    '/relay/models': { get: { tags: ['Relay'], summary: 'The models the relay offers this device\'s person', operationId: 'relayModels', 'x-scope': 'relay:use',
      description: 'OpenAI\'s list shape. Use `<hub>/api/v1/relay` as an OpenAI base URL and this device\'s token as the API key. Answered only while the relay is on for paired devices and this device\'s own switch is on (Field → API keys → Model relay). See PROTOCOL.md §23.5.',
      responses: { 200: json(obj({ object: str(), data: arr(obj({ id: str(), object: str(), owned_by: str() })) })), ...refusals, ...std(401) } } },
    '/relay/chat/completions': { post: { tags: ['Relay'], summary: 'Ask one of the hub\'s models, through its provider', operationId: 'relayChat', 'x-scope': 'relay:use',
      description: 'An OpenAI chat completions body, sent on as written with the model the relay picked (`model`: one of /relay/models, or empty for the first); `stream: true` answers as server-sent events. The provider\'s key never leaves the hub. Every request is counted for this device\'s person and tagged `relay:device:<id>`; never a word of it is kept. JSON bodies up to 2 MB.',
      requestBody: { required: true, content: { 'application/json': { schema: obj({ model: str(), messages: arr(obj({ role: str(), content: str() })) }) } } },
      responses: { 200: json(obj({ id: str(), object: str(), choices: arr(obj({ message: obj({ role: str(), content: str() }) })) }), 'One answer, or text/event-stream when streamed.'), 404: json(error, 'The model is not one the relay offers this device.'), ...refusals, ...std(401) } } },
  };
}

module.exports = { mount, openapi };

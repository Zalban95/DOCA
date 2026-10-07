'use strict';

/**
 * Secrets for devices, the routes (TODO P1.3). The panel's under Field → Connectors (`/api/connectors/sealed/*`,
 * host — like the logins and the keys for services, these are the owner's secrets): list them and where they were
 * used, keep one, forget one; never a value back. The device's (`GET /api/v1/mcp/self/seal`, its own token, scope
 * `mcp:self`, PROTOCOL.md §22.3): its seal key, minted the first time it asks, so the hub can hand it a secret sealed
 * for it alone.
 */
const vault = require('./vault');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };

function mount(app) {
  app.get('/api/connectors/sealed/all', h(async () => ({ secrets: await vault.list(), uses: await vault.uses() })));
  app.post('/api/connectors/sealed/all', h(async req => ({ secret: await vault.save(req.body || {}, req.auth?.user?.id || null) })));
  app.delete('/api/connectors/sealed/:name', h(req => vault.remove(req.params.name)));
}

function mountDevice(router) {
  const { requireScope } = require('../api-v1/auth');
  router.get('/mcp/self/seal', requireScope('mcp:self'), (req, res) => {
    res.json({ v: 1, alg: 'A256GCM', key: require('./seal').mint(req.device.id), aad: `doca-seal:${req.device.id}` });
  });
}

function openapi({ obj, str, json, std }) {
  return {
    '/mcp/self/seal': { get: { tags: ['Devices'], summary: 'This device\'s seal key, for secrets the hub hands it sealed', operationId: 'mcpSelfSeal', 'x-scope': 'mcp:self',
      description: 'Minted the first time the device asks, then the same. Keep it where only this app reads it. The hub seals a secret for this device alone with it (AES-256-GCM, additional data `aad`) and calls the hidden MCP tool secret_fill with { sealed: { v, iv, data } } — data is the ciphertext followed by the 16-byte tag, base64. Open it, check device, iat and nonce, use the value as `how` says (field, type, clipboard), forget it, and answer without it. See PROTOCOL.md §22.3.',
      responses: { 200: json(obj({ v: { type: 'integer' }, alg: str(), key: str({ description: '32 bytes, base64.' }), aad: str() })), ...std(401, 403) } } },
  };
}

module.exports = { mount, mountDevice, openapi };

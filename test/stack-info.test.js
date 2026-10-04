'use strict';

// The Start/Stop card is named by what it drives — docker compose in the stack folder — and only drawn when
// there is a stack (live review 2026-10-04: it said "DOCA Service Control" while it ran OpenClaw's compose).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

test('no compose file: no stack; one that names OpenClaw: the OpenClaw stack', async () => {
  const { COMPOSE_DIR } = require('../modules/paths');
  fs.rmSync(path.join(COMPOSE_DIR, 'docker-compose.yml'), { force: true });
  const none = await H.api(null, 'GET', '/api/stack/info');
  assert.equal(none.status, 200);
  assert.equal(none.body.exists, false);
  fs.mkdirSync(COMPOSE_DIR, { recursive: true });
  fs.writeFileSync(path.join(COMPOSE_DIR, 'docker-compose.yml'), 'services:\n  openclaw-gateway:\n    image: openclaw:local\n');
  const oc = await H.api(null, 'GET', '/api/stack/info');
  assert.deepEqual([oc.body.exists, oc.body.label, oc.body.file], [true, 'OpenClaw stack', 'docker-compose.yml']);
  const member = await H.signIn('member');
  assert.equal((await H.api(null, 'GET', '/api/stack/info', undefined, { Cookie: member.cookie })).status, 403, 'the machine: host only');
});

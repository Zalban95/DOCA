'use strict';

// Accounts in SQL (auth phase 2): existing JSON accounts are imported once; the JSON backend still passes the contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('an install\'s JSON accounts are imported into the database, once, and still sign in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-acc-'));
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
  const w = (n, v) => fs.writeFileSync(path.join(dir, 'auth', `${n}.json`), JSON.stringify(v));
  w('users', { usr_1: { id: 'usr_1', email: 'old@x.test', name: 'Old', passwordHash: 'h', createdAt: '2026-01-01T00:00:00Z' } });
  w('orgs', { org_1: { id: 'org_1', name: 'Home', createdAt: '2026-01-01T00:00:00Z' } });
  w('memberships', [{ orgId: 'org_1', userId: 'usr_1', role: 'owner', status: 'active' }]);
  w('sessions', { abc: { userId: 'usr_1', orgId: 'org_1', expiresAt: '2099-01-01T00:00:00Z' } });
  const script = `
    const S = require(${JSON.stringify(path.join(__dirname, '..', 'modules', 'auth', 'store'))});
    const out = { user: S.userByEmail('OLD@x.test')?.name, role: S.membership('org_1', 'usr_1')?.role, session: S.sessionByHash('abc')?.userId, count: S.userCount() };
    S.createUser({ email: 'new@x.test', passwordHash: 'h' });
    console.log(JSON.stringify(out));`;
  const env = { ...process.env, DOCA_DATA_DIR: dir };
  delete env.DOCA_DB_URL; delete env.DOCA_AUTH_BACKEND;
  const first = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { user: 'Old', role: 'owner', session: 'usr_1', count: 1 });
  assert.ok(fs.existsSync(path.join(dir, 'doca.db')), 'they are in the database');
  const again = spawnSync(process.execPath, ['-e', script.replace("S.createUser({ email: 'new@x.test', passwordHash: 'h' });", '')], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(again.stdout).count, 2, 'imported once: the user made after the import is still there, nothing doubled');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the JSON implementation still passes the store contract (it serves PostgreSQL installs)', () => {
  const r = spawnSync(process.execPath, ['--test', path.join(__dirname, 'auth-store.test.js')], { env: { ...process.env, DOCA_AUTH_BACKEND: 'json' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.slice(-2000));
});

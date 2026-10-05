'use strict';

// Which container CLI this host has (modules/containers.js, TODO H1.6): docker, else podman, or the one named.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('docker when it is there, podman when only it is, the named one when DOCA_CONTAINER_CLI says', () => {
  const containers = require('../modules/containers');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-cli-'));
  const exe = name => { const f = path.join(bin, process.platform === 'win32' ? `${name}.cmd` : name); fs.writeFileSync(f, ''); fs.chmodSync(f, 0o755); };
  const saved = { PATH: process.env.PATH, CLI: process.env.DOCA_CONTAINER_CLI };
  try {
    delete process.env.DOCA_CONTAINER_CLI;
    process.env.PATH = bin;
    exe('podman'); containers._reset();
    assert.equal(containers.cli(), 'podman');
    exe('docker'); containers._reset();
    assert.equal(containers.cli(), 'docker');
    process.env.DOCA_CONTAINER_CLI = 'nerdctl';
    assert.equal(containers.cli(), 'nerdctl');
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.CLI === undefined) delete process.env.DOCA_CONTAINER_CLI; else process.env.DOCA_CONTAINER_CLI = saved.CLI;
    containers._reset();
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

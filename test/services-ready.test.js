'use strict';

// Starting an inference service (modules/services.js): `docker run` returning is not the service answering. A start
// waits for its port, and a container that crash-loops is reported with its log and a reason, and removed — found
// on the live panel with Kokoro's GPU image on a GPU newer than its PyTorch (2026-10-05).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const H = require('./helpers');

const posix = process.platform !== 'win32';
const calls = path.join(H.tmp, 'fake-docker.log');
let svc;

before(async () => {
  if (posix) {
    // A container CLI that runs anything, then says the container restarts with a CUDA error.
    const fake = path.join(H.tmp, 'fake-docker');
    fs.writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(calls)}\ncase "$1" in\n  run) echo 7734afa41b84 ;;\n  inspect) echo "restarting 3" ;;\n  logs) echo "RuntimeError: Warmup failed: CUDA error: no kernel image is available for execution on the device" >&2 ;;\nesac\nexit 0\n`, { mode: 0o755 });
    process.env.DOCA_CONTAINER_CLI = fake;
  }
  await H.start();
});
after(async () => { delete process.env.DOCA_CONTAINER_CLI; await H.stop(); });

const start = async body => {
  const r = await fetch(`${H.base}/api/services/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: H.owner.cookie }, body: JSON.stringify(body) });
  const frames = (await r.text()).split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  return { text: frames.map(f => f.status || '').join(''), done: frames.find(f => f.done) };
};

test('a crash at start is reported with its reason and removed, never "started"', { skip: !posix && 'a POSIX fake CLI' }, async () => {
  svc = require('../modules/services').INFERENCE_SERVICES.find(s => s.id === 'kokoro');
  svc.port = 1;   // nothing answers here
  const r = await start({ id: 'kokoro', gpu: '1' });
  assert.equal(r.done.ok, false);
  assert.match(r.text, /--gpus device=1/);
  assert.match(r.text, /no kernel image is available/, 'its own log');
  assert.match(r.text, /PyTorch was not built for this GPU.*No GPU \(CPU\)/, 'and what to do');
  assert.doesNotMatch(r.text, /started/);
  assert.match(fs.readFileSync(calls, 'utf8'), /^rm -f doca-kokoro$/m, 'removed, so it does not loop');
});

test('a service that answers is reported as answering', { skip: !posix && 'a POSIX fake CLI' }, async () => {
  const s = http.createServer((_q, res) => res.end('{"voices":[]}'));
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  svc.port = s.address().port;
  const r = await start({ id: 'kokoro', gpu: '' });
  s.close();
  assert.equal(r.done.ok, true, r.text);
  assert.match(r.done.status, /answers on http:\/\/localhost:/);
  assert.match(r.text, /kokoro-fastapi-cpu/, 'no GPU: the CPU image');
});

test('the reasons a person can act on', () => {
  const { diagnose } = require('../modules/services');
  assert.match(diagnose('torch.cuda.OutOfMemoryError: CUDA out of memory'), /ran out of memory/);
  assert.match(diagnose('Bind for 0.0.0.0:8880 failed: port is already allocated'), /port is taken/);
  assert.equal(diagnose('all good'), null);
});

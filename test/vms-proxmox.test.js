'use strict';

// Proxmox VE in the VMs tab (vms-proxmox.js; R16): through the API service "proxmox" — its key as PVEAPIToken, its
// guests as rows named "<name> (<vmid>)", start, shut down and stop by Proxmox's own actions; absent, a hint.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');

let pve, heard = [];
test.before(async () => {
  await H.start();
  pve = http.createServer((req, res) => {
    heard.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.endsWith('/cluster/resources')) return res.end(JSON.stringify({ data: [
      { type: 'qemu', vmid: 100, name: 'web', node: 'pve1', status: 'running' },
      { type: 'lxc', vmid: 101, name: 'dns', node: 'pve1', status: 'stopped' },
      { type: 'storage', storage: 'local', node: 'pve1' }] }));
    res.end('{"data":"UPID:pve1:task"}');
  });
  await new Promise(r => pve.listen(0, '127.0.0.1', r));
});
test.after(async () => { pve.close(); await H.stop(); });

test('absent until the service is set up, and says how', async () => {
  const row = (await H.api(null, 'GET', '/api/vms')).body.hypervisors.find(h => h.id === 'proxmox');
  assert.equal(row.available, false);
  assert.match(row.error, /Field → Connectors → API services/);
});

test('set up: its guests listed, acted on by Proxmox\'s own actions with the token', async () => {
  const openapi = fs.readFileSync(path.join(__dirname, '../modules/api-services/templates/proxmox-ve.openapi.json'), 'utf8');
  const s = await H.api(null, 'POST', '/api/connectors/services/all', { name: 'proxmox', server: `http://127.0.0.1:${pve.address().port}/api2/json`,
    key: 'root@pam!doca=11111111-2222', auth: { type: 'apiKey', in: 'header', name: 'Authorization', prefix: 'PVEAPIToken=' }, openapi });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const row = (await H.api(null, 'GET', '/api/vms')).body.hypervisors.find(h => h.id === 'proxmox');
  assert.equal(row.available, true, row.error);
  assert.deepEqual(row.vms.map(v => [v.name, v.state, v.kind]), [['web (100)', 'running', 'vm'], ['dns (101)', 'stopped', 'container']]);
  assert.equal(heard[0].auth, 'PVEAPIToken=root@pam!doca=11111111-2222');
  heard = [];
  assert.equal((await H.api(null, 'POST', '/api/vms/proxmox/action', { name: 'web (100)', action: 'stop' })).status, 200);
  assert.deepEqual(heard.filter(h => h.method === 'POST').map(h => h.url), ['/api2/json/nodes/pve1/qemu/100/status/shutdown']);
  assert.equal((await H.api(null, 'POST', '/api/vms/proxmox/action', { name: 'dns (101)', action: 'start' })).status, 200);
  assert.ok(heard.some(h => h.url === '/api2/json/nodes/pve1/lxc/101/status/start'));
  const kill = await H.api(null, 'POST', '/api/vms/proxmox/action', { name: 'dns (101)', action: 'kill' });
  assert.equal(kill.status, 500);
  assert.match(kill.body.error, /shut down, not stopped at once/);
  assert.equal((await H.api(null, 'POST', '/api/vms/proxmox/action', { name: 'nope (9)', action: 'start' })).status, 404);
});

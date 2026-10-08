'use strict';

/**
 * The status column's Machines (public/js/machines-rows.js): the three kinds drawn from the hub's rows, the running
 * ones as rows with their point, the stopped counted with a link to their tab — and, for someone the rows are refused
 * to, the running containers from the status, in the same rows.
 */
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const F = require('./frontend');

function page(answer) {
  const els = { 's-containers': { innerHTML: '' }, 's-containers-count': { textContent: '' } };
  const went = [];
  const ctx = { document: { hidden: false, getElementById: id => els[id] || null }, CSS: { escape: s => s },
    apiFetch: async url => { assert.equal(url, '/api/machines/rows'); if (answer instanceof Error) throw answer; return answer; },
    nav: tab => went.push(['nav', tab]), liveFocus: id => went.push(['live', id]) };
  vm.createContext(ctx);
  vm.runInContext(`${F.source('lib/html.js', 'machines-rows.js')}\n;this.machinesSidebar = machinesSidebar; this.machineGo = machineGo;`, ctx);
  return { ctx, els, went };
}

const rows = [
  { kind: 'container', id: 'a1', name: 'web', state: 'running', point: 'up', detail: 'nginx:1 · Up 2 hours', tab: 'docker', live: false },
  { kind: 'container', id: 'b2', name: 'batch', state: 'exited', point: 'down', detail: 'busybox', tab: 'docker', live: false },
  { kind: 'container', id: 'c3', name: 'broken', state: 'exited', point: 'error', detail: 'app · Exited (1)', tab: 'docker', live: false },
  { kind: 'computer', id: 'pc1', name: 'tester-pc', state: 'running', point: 'up', detail: 'Tester · running', tab: 'computers', live: true },
  { kind: 'vm', id: 'libvirt:devbox', name: 'devbox', state: 'running', point: 'up', detail: 'libvirt / KVM · ubuntu 24.04', tab: 'vms', live: true },
  { kind: 'vm', id: 'libvirt:old', name: 'old', state: 'stopped', point: 'down', detail: 'libvirt / KVM', tab: 'vms', live: false },
];

test('a host sees containers, computers and VMs: running as rows with a point, stopped as a count that opens the tab', async () => {
  const { ctx, els, went } = page({ rows });
  await ctx.machinesSidebar([]);
  const html = els['s-containers'].innerHTML;
  for (const label of ['Containers', 'Computers', 'VMs']) assert.match(html, new RegExp(`<span>${label}</span>`));
  assert.match(html, /c-item m-row running[\s\S]*web[\s\S]*nginx:1/);
  assert.match(html, /c-item m-row exited[\s\S]*broken/, 'one in trouble is shown, red');
  assert.doesNotMatch(html, />batch</, 'a stopped one is counted, not listed');
  assert.match(html, /nav\(&quot;docker&quot;\)[^>]*>1 stopped/);
  assert.match(html, /nav\(&quot;vms&quot;\)[^>]*>1 stopped/);
  assert.match(html, /tester-pc/); assert.match(html, /ubuntu 24\.04/);
  assert.equal(els['s-containers-count'].textContent, '3 running');
  ctx.machineGo('vm', 'libvirt:devbox', true); ctx.machineGo('computer', 'pc1', true); ctx.machineGo('container', 'a1', false);
  assert.deepEqual(went, [['live', 'v:libvirt:devbox'], ['live', 'c:pc1'], ['nav', 'docker']]);
});

test('without the host right the running containers from the status are drawn the same way, and the rows are not asked again', async () => {
  const { ctx, els } = page(new Error('Your role (member) cannot do this; it needs the "host" right.'));
  await ctx.machinesSidebar([{ ID: 'a1', Names: 'web', Image: 'nginx:1', State: 'running', Status: 'Up 2 hours' }]);
  assert.match(els['s-containers'].innerHTML, /<span>Containers<\/span>[\s\S]*c-item m-row running[\s\S]*web/);
  assert.doesNotMatch(els['s-containers'].innerHTML, /Computers|VMs/);
  ctx.apiFetch = async () => { throw new Error('asked again'); };
  await ctx.machinesSidebar([]);
  assert.match(els['s-containers'].innerHTML, /None running/);
});

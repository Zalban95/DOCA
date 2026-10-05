'use strict';

// A specialist that keeps a computer of its own (definition `computer: own`, computers.ownFor; TODO H13.3): made the
// first time, the same one every mission after, never tidied away by the sweep. Docker is stood in for, so this runs
// anywhere; test/computers.test.js drives a real container where the image exists.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

before(() => H.start());
after(() => H.stop());

test('the definition says so, in JSON and in its markdown', () => {
  const registry = require('../modules/agents/registry');
  const def = registry.save({ id: 'browser-clerk', label: 'Browser clerk', role: 'You fill in web forms.', kits: ['computer'], computer: 'own' });
  assert.equal(registry.get('browser-clerk').computer, 'own');
  const md = require('../modules/agents/markdown').format(registry.get('browser-clerk'));
  assert.match(md, /^computer: own$/m);
  assert.equal(require('../modules/agents/markdown').parse(md, { fallbackId: 'x' }).computer, 'own');
  assert.equal(registry.save({ id: 'plain', label: 'Plain', role: 'r', computer: 'yes please' }) && registry.get('plain').computer, null, 'only "own"');
  void def;
});

test('its computer is made once, reused by every mission, and kept by the sweep', async () => {
  const computers = require('../modules/computers');
  const store = require('../modules/store');
  const real = computers.create;
  let made = 0;
  computers.create = async opts => {
    made++;
    const row = { id: `own${made}`, name: opts.name, purpose: opts.purpose, auto: !!opts.auto, pinned: false, agentType: opts.agentType, createdAt: new Date().toISOString() };
    store.writeJson('computers', { computers: [...store.readJson('computers', { computers: [] }).computers, row] });
    return row;
  };
  try {
    const def = require('../modules/agents/registry').get('browser-clerk');
    const a = await computers.ownFor(def), b = await computers.ownFor(def);
    assert.equal(a, b, 'the same computer next time');
    assert.equal(made, 1);
    const row = computers.all().find(c => c.id === a);
    assert.equal(row.agentType, 'browser-clerk');
    assert.equal(row.auto, false, 'not an agent\'s throwaway: the sweep removes only those');
    assert.match(row.name, /Browser clerk's computer/);
  } finally { computers.create = real; }
});

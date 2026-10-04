'use strict';

// The skills search matches loosely: forms, prefixes, typos, synonyms, weighted by where (skill-match.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matcher } = require('../modules/harness/skill-match');

const pr = { name: 'pr-review', description: 'Review a pull request before merging', body: '# Reviewing\n\nUse when a branch is ready.\n\nRun the tests, read the diff, list the risks.' };
const pdf = { name: 'pdf-tables', description: 'Pull tables out of PDF files', body: 'Use pdfplumber. Save each table as CSV.' };
const deploy = { name: 'ship-it', description: 'Release the app to production', body: '## Steps\nBuild, tag, upload.' };

const score = (q, item) => matcher(q)(item);

test('word forms and partial words match', () => {
  assert.ok(score('reviews', pr) > 0, 'plural');
  assert.ok(score('reviewing', pr) > 0, 'gerund');
  assert.ok(score('tabl', pdf) > 0, 'a prefix');
  assert.ok(score('merge', pr) > 0, 'merging ↔ merge');
});

test('a typo still finds it, and so does a word that means the same', () => {
  assert.ok(score('reveiw', pr) > 0, 'one swapped letter');
  assert.ok(score('spreadshet', { name: 'sheets', description: 'Edit a spreadsheet', body: '' }) > 0, 'two letters off in a long word');
  assert.ok(score('deploy', deploy) > 0, 'deploy ↔ release');
  assert.ok(score('audit', pr) > 0, 'audit ↔ review');
});

test('where it matches decides the rank: name over description over body', () => {
  const inName = { name: 'invoice', description: 'x', body: '' };
  const inDesc = { name: 'a', description: 'make an invoice', body: '' };
  const inBody = { name: 'b', description: 'y', body: 'An opening paragraph.\n\nLater it mentions invoice once.' };
  const s = [inName, inDesc, inBody].map(i => score('invoice', i));
  assert.ok(s[0] > s[1] && s[1] > s[2], JSON.stringify(s));
  const heading = { name: 'c', description: 'z', body: '# Invoices\n\nother words' };
  assert.ok(score('invoice', heading) > s[2], 'a heading counts more than a passing mention');
});

test('covering more of the query ranks higher; under half of it is no result', () => {
  assert.ok(score('pull request review', pr) > score('pull request review', pdf));
  assert.equal(score('kubernetes helm chart', pdf), 0);
  assert.equal(score('', pr), 0);
});

test('filler words do not carry a result on their own', () => {
  assert.equal(score('make slides', { name: 'make-a-specialist', description: 'Create a new specialist agent type', body: '' }), 0);
  assert.ok(score('make slides', { name: 'pptx', description: 'Build a presentation deck', body: '' }) > 0, 'slides ↔ deck/presentation');
  assert.ok(score('make', { name: 'make-a-specialist', description: 'x', body: '' }) > 0, 'a query of only filler still searches');
});

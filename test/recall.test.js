'use strict';

/**
 * Recall (harness/recall.js): finding an earlier conversation by its title,
 * topics, summary or words, through the recall_conversations tool.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H      = require('./helpers');
const memory = require('../modules/harness/memory');
const recall = require('../modules/harness/recall');
const tools  = require('../modules/harness/tools');
const kits   = require('../modules/harness/kits');

test.before(() => H.start());
test.after(() => H.stop());

test('the fold\'s Topics line is split off the summary', () => {
  assert.deepEqual(recall.splitTopics('We fixed the bridge.\nTopics: Blender bridge, GPU drivers, blender bridge.'),
    { summary: 'We fixed the bridge.', topics: ['blender bridge', 'gpu drivers'] });
  assert.deepEqual(recall.splitTopics('No line here.'), { summary: 'No line here.', topics: null });
});

test('search finds a conversation by topics, summary and transcript words; read returns it', async () => {
  const a = memory.createSession('Mount mockup', { activate: false });
  memory.updateSession(a.id, { summary: 'Designed the telescope mount in Blender via the bridge on port 9876.', topics: ['blender bridge', 'telescope'] });
  const b = memory.createSession('Unrelated', { activate: false });
  memory.append(b.id, { role: 'user', content: 'the zeroconf announcer keeps dropping on wifi' });
  memory.append(b.id, { role: 'assistant', content: 'Restarted avahi; the announcer is back.' });

  const hits = recall.search('blender bridge');
  assert.equal(hits[0].id, a.id);
  assert.ok(!hits.some(h => h.id === b.id));
  assert.equal(recall.search('zeroconf announcer')[0].id, b.id, 'words only in the transcript are found');
  assert.ok(!recall.search('blender', { exclude: a.id }).some(h => h.id === a.id), 'the asking conversation is left out');

  const found = await tools.call('recall_conversations', { query: 'telescope' }, [], { sessionId: b.id });
  assert.match(found, new RegExp(`Mount mockup — id ${a.id}`));
  assert.match(found, /topics: blender bridge, telescope/);
  const read = await tools.call('recall_conversations', { action: 'read', id: b.id });
  assert.match(read, /\[user .*\] the zeroconf announcer/);
  assert.match(read, /No summary yet/);
  assert.match(await tools.call('recall_conversations', { query: 'nothing-like-this' }), /No earlier conversation/);
  assert.match(await tools.call('recall_conversations', { action: 'read', id: 'x' }), /^Error: No conversation x/);
});

test('recall is in the memory kit and asks no approval', () => {
  assert.equal(kits.kitOf('recall_conversations'), 'memory');
  assert.ok(require('../modules/harness/approval').FREE.has('recall_conversations'));
});

'use strict';

// The spill folder (harness/tool-results/<conversation>/) is its conversation's, as the transcript is: the file tools
// reach a conversation's saved tool output only for a person who may use that conversation, and what is in it reads
// masked — a settings file or a .env printed by `cat` and kept whole there is no way around secret-view (review of
// 2026-10-16; harness/spill-access.js).
const H      = require('./helpers');   // first: it points the data folder at a temporary one
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

test.after(() => H.stop());

test('a conversation\'s saved tool output: its person and a host read it, masked; another person gets a refusal', async () => {
  await H.start();
  const memory = require('../modules/harness/memory');
  const tools = require('../modules/harness/tools');
  const { spillTool } = require('../modules/harness/turn/messages');
  const a = await H.signIn('member'), b = await H.signIn('member');
  const person = p => ({ id: p.user.id, role: p.role, name: p.role, orgId: p.orgId });
  const mine = memory.createSession('A\'s', { activate: false });
  memory.updateSession(mine.id, { person: { id: a.user.id, orgId: a.orgId } });
  const child = memory.createSession('A\'s work chat', { activate: false, parentId: mine.id });
  const TOKEN = 'xoxb-spilled-secret-123456';
  const text = `exit 0\n{\n  "channels": { "slack": { "botToken": "${TOKEN}" } },\n  "theme": "dark"\n}\nOPENAI_API_KEY=sk-also-secret-789\n`;
  const file = spillTool(mine.id, { tool_call_id: 'call_1', name: 'shell', content: text });
  const later = spillTool(child.id, { tool_call_id: 'call_2', name: 'shell', content: 'plain output' });
  const read = (p, user) => tools.call('read_file', { path: p }, [], { sessionId: mine.id, user });

  const own = await read(file, person(a));
  assert.ok(!own.includes(TOKEN) && !own.includes('sk-also-secret-789'), own);
  assert.match(own, /"botToken": "•+"/);
  assert.match(own, /OPENAI_API_KEY=•+/);
  assert.match(own, /"theme": "dark"/, 'the rest reads as it is');
  assert.match(await read(later, person(a)), /plain output/, 'a conversation it started is in its chain');

  const other = await read(file, person(b));
  assert.match(other, /not yours/);
  assert.ok(!other.includes(TOKEN));
  assert.match(await tools.call('list_dir', { path: path.dirname(path.dirname(file)) }, [], { user: person(b) }), /every conversation's saved tool output/);
  assert.match(await tools.call('list_dir', { path: path.dirname(file) }, [], { user: person(b) }), /not yours/);
  // Searched from above, the spill files are left out for everyone; read_file is the way back to one.
  const found = await tools.call('search_files', { query: 'theme', path: path.dirname(path.dirname(file)) }, [], { user: person(a) }).catch(e => `Error: ${e.message}`);
  assert.ok(!found.includes(TOKEN));

  const host = await read(file, { id: H.owner.user.id, role: 'owner' });
  assert.ok(!host.includes(TOKEN), 'a host reads it too, masked');
  assert.match(await read(file, null), /"theme": "dark"/, 'no person on the turn (before accounts): not narrowed');
  assert.ok(fs.existsSync(file));
});

'use strict';

/**
 * A question the agent asks at the panel is its person's (reach.mayAnswer; 2026-10-17: every person's agent questions
 * were listed to anyone signed in, and answerable by anyone who chats). The person it was asked for sees and answers
 * it; another person — a host included — does not see it and cannot answer it; one asked for nobody is a host's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');   // first: it points the settings at a temporary folder

test.after(() => H.stop());

test('a panel question reaches only its person', async () => {
  await H.start();
  const reach = require('../modules/harness/reach');
  const member = await H.signIn('member');
  const other = await H.signIn('member');
  const as = who => ({ Cookie: who.cookie });
  // Nothing of theirs is paired, so the question waits at the panel only.
  const asked = reach.ask({ question: 'Which level first?', choices: ['One', 'Two'], timeoutSec: 30, personId: member.user.id });
  let list;
  for (let i = 0; i < 50; i++) { list = (await H.api(null, 'GET', '/api/harness/questions', undefined, as(member))).body.questions; if (list.length) break; await H.sleep(50); }
  assert.equal(list.length, 1, 'its person sees it');
  assert.equal(list[0].personId, undefined, 'whose it is stays on the hub');
  const id = list[0].id;
  assert.equal((await H.api(null, 'GET', '/api/harness/questions', undefined, as(other))).body.questions.length, 0, 'another person does not');
  assert.equal((await H.api(null, 'GET', '/api/harness/questions')).body.questions.length, 0, 'nor does a host');
  const wrong = await H.api(null, 'POST', `/api/harness/questions/${id}`, { text: 'Two' }, as(other));
  assert.equal(wrong.status, 409, 'and cannot answer it');
  const right = await H.api(null, 'POST', `/api/harness/questions/${id}`, { choiceId: 'c1' }, as(member));
  assert.equal(right.status, 200, JSON.stringify(right.body));
  const r = await asked;
  assert.equal(r.status, 'answered');

  // Asked for nobody (a hub routine, before accounts): a host's.
  const nobody = reach.ask({ question: 'Restart the stack?', choices: ['Yes', 'No'], timeoutSec: 30 });
  let mine;
  for (let i = 0; i < 50; i++) { mine = (await H.api(null, 'GET', '/api/harness/questions')).body.questions; if (mine.length) break; await H.sleep(50); }
  assert.equal(mine.length, 1, 'a host sees it');
  assert.equal((await H.api(null, 'GET', '/api/harness/questions', undefined, as(member))).body.questions.length, 0, 'a member does not');
  await H.api(null, 'POST', `/api/harness/questions/${mine[0].id}`, { choiceId: 'c2' });
  await nobody;
});

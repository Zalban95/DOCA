'use strict';

/**
 * The agent reaching a person on a device: a question it waits for, and a
 * notice with a picture.
 *
 * What is worth pinning here is not that a prompt can be created — `prompts`
 * has its own suite — but the three decisions in `reach.js` that a later edit
 * could quietly undo: an unanswered question is *withdrawn* rather than left
 * glowing on a wrist, a picture is readable by the device it was sent to
 * without inventing a scope, and a sub-agent cannot ask at all.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');

before(h.start);
after(h.stop);

const tools  = require('../modules/harness/tools');
const reach  = require('../modules/harness/reach');
const prompts = require('../modules/api-v1/prompts');

/** A 1×1 png, small enough to be beside the point. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c6300010000050001' + '0d0a2db40000000049454e44ae426082', 'hex');

/** Wait until a prompt addressed to this device appears, then answer it. */
async function answerFirstPrompt(token, pick, { attempts = 40 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const list = await h.api(token, 'GET', '/api/v1/prompts');
    const p = list.body.prompts?.[0];
    if (p) {
      const choice = pick(p);
      return h.api(token, 'POST', `/api/v1/prompts/${p.id}/select`,
        { selectionId: `sel-${Math.random().toString(16).slice(2)}`, choiceId: choice });
    }
    await h.sleep(50);
  }
  throw new Error('no prompt ever arrived');
}

test('a question reaches the watch and the answer comes back to the agent', async () => {
  const watch = h.mkDevice('reach-watch', 'watch', h.WATCH_CAPS);

  const asking = tools.call('ask_device', {
    to: 'watch', question: 'Which build do you want?', choices: ['Debug', 'Release'], timeoutSec: 20,
  });

  const answered = await answerFirstPrompt(watch.token, p => {
    // The choices arrive as the model wrote them, plus a way out.
    assert.deepEqual(p.choices.filter(c => c.type === 'option').map(c => c.label), ['Debug', 'Release']);
    assert.ok(p.choices.some(c => c.type === 'dismiss'), 'every question can be declined');
    assert.equal(p.title, 'Which build do you want?');
    return p.choices[1].id;
  });
  assert.equal(answered.status, 200);

  const out = await asking;
  assert.match(out, /answered: "Release"/);
  assert.match(out, /reach-watch/, 'the model is told which device answered, not just that one did');
});

test('a question nobody answers is withdrawn, and says so', async () => {
  const watch = h.mkDevice('reach-silent', 'watch', h.WATCH_CAPS);

  const out = await tools.call('ask_device', {
    to: watch.device.id, question: 'Still there?', choices: ['Yes', 'No'], timeoutSec: 5,
  });
  assert.match(out, /Nobody answered within 5s/);
  assert.match(out, /withdrawn/);

  // And the device is not left holding it: an open prompt with nobody listening
  // offers choices that lead nowhere.
  const open = await h.api(watch.token, 'GET', '/api/v1/prompts');
  assert.equal(open.body.prompts.length, 0, 'the question is gone from the device');
  assert.ok(prompts.list().filter(p => p.title === 'Still there?').every(p => p.state === 'cancelled'),
    'and cancelled on the hub, not merely ignored');
});

test('declining is an answer, and reads as one rather than as a failure', async () => {
  const watch = h.mkDevice('reach-decline', 'watch', h.WATCH_CAPS);
  const asking = tools.call('ask_device', { to: 'watch', question: 'Deploy now?', choices: ['Yes', 'Later'], timeoutSec: 20 });
  await answerFirstPrompt(watch.token, p => p.choices.find(c => c.type === 'dismiss').id);
  const out = await asking;
  assert.match(out, /chose not to answer/);
  assert.equal(out.includes('Error'), false);
});

test('a question needs choices worth choosing between, and a device that can answer', async () => {
  assert.match(await tools.call('ask_device', { question: 'Well?', choices: ['Only one'] }), /at least two choices/);
  assert.match(await tools.call('ask_device', { question: 'Well?', choices: ['a', 'b'], to: 'toaster' }),
    /No device matches "toaster"/, 'a dead end lists what does exist');
});

test('a picture is sent as the recipient\'s own media, so the recipient can read it', async () => {
  const watch = h.mkDevice('reach-pics', 'watch', h.WATCH_CAPS);
  const stream = h.sse(watch.token);
  await stream.ready;

  const file = require('path').join(h.tmp, 'render.png');
  require('fs').writeFileSync(file, PNG);

  const out = await tools.call('tell_device', { to: 'watch', title: 'Render finished', text: 'Frame 240 of 240.', imagePath: file });
  assert.match(out, /Sent with a \d+ KB picture/);
  assert.match(out, /reach-pics/);

  const alert = await stream.waitFor('alert');
  const pic = alert.payload.body.find(b => b.type === 'media');
  assert.ok(pic, 'the picture arrives as a media block');
  assert.match(pic.url, /^\/api\/v1\/media\/med_/);

  // The watch has media:upload and no media:*. It can still read this one,
  // because the bytes were stored as its own — no new scope, no sharing table.
  const bytes = await h.api(watch.token, 'GET', pic.url);
  assert.equal(bytes.status, 200);
  assert.equal(Buffer.compare(bytes.body, PNG), 0, 'and they are the bytes that were on disk');

  stream.close();
});

test('a notice reports whether it was seen or queued, and refuses what it cannot send', async () => {
  const watch = h.mkDevice('reach-queue', 'watch', h.WATCH_CAPS);
  const out = reach.tell({ to: watch.device.id, title: 'Done' });
  assert.equal(out.delivered.length, 1);
  assert.match(out.delivered[0].note, /offline, queued/, 'the model learns it landed in a queue, not on a screen');

  // One poll later it is a device that checks in, not an offline one.
  await h.api(watch.token, 'GET', '/api/v1/events');
  const polled = reach.tell({ to: watch.device.id, title: 'Again' });
  assert.match(polled.delivered[0].note, /collected on its next check/, 'a polling watch is not reported offline');

  assert.match(await tools.call('tell_device', { title: 'Look', to: 'watch', imagePath: require('path').join(h.tmp, 'notes.txt') }),
    /not an image this can send/);
});

test('a specialist agent cannot ask the user anything, whatever its definition says', () => {
  const registry = require('../modules/agents/registry');
  assert.ok(registry.NEVER.includes('ask_device'), 'questions have one owner: the orchestrator');
  const saved = registry.save({ id: 'nosy', label: 'Nosy', role: 'Ask things', tools: ['ask_device', 'shell'] });
  assert.equal(saved.tools.includes('ask_device'), false);
  assert.ok(saved.refusedTools.includes('ask_device'), 'and the panel is told what was removed');
  registry.remove('nosy');
});

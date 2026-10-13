'use strict';

/**
 * A chat's kit (asked 2026-10-09): skills attached by mode, project or chat (harness/skill-use.js), trigger words
 * (skill-triggers.js, skill-next.js), slash commands and loops (slash.js, schedules/loop.js) and a chat's own compaction
 * (turn/compact-choice.js) — against a scripted model, and with the prompt cache held: the system prompt is the same
 * bytes across steps and turns while the attachments stay, and a suggestion only changes the tail.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers');   // first: it points the settings at a temporary folder (see its top)

let server;
const bodies = [];
const sse = (res, delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } })}\n\n`); res.end('data: [DONE]\n\n'); };
before(async () => {
  await H.start();
  server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const msgs = body.messages || [];
      const sys = msgs.find(m => m.role === 'system')?.content || '';
      if (/Merge the notes/.test(sys)) return sse(res, { content: 'Earlier: the person asked things.\nTopics: tests' });
      bodies.push(body);
      const lastUser = [...msgs].reverse().find(m => m.role === 'user' && !String(m.content).startsWith('[panel readings'))?.content || '';
      const since = msgs.slice(msgs.lastIndexOf(msgs.filter(m => m.role === 'user' && !String(m.content).startsWith('[panel readings')).pop()));
      if (/two-step/.test(lastUser) && !since.some(m => m.role === 'tool'))
        return sse(res, { tool_calls: [{ index: 0, id: `c${bodies.length}`, type: 'function', function: { name: 'skill', arguments: '{"action":"list"}' } }] });
      if (/LOOPDONE/.test(lastUser) && /Loop run 2/.test(lastUser)) return sse(res, { content: 'All of it is finished.\n[loop done]' });
      return sse(res, { content: 'ok' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(require('../modules/paths').CONFIG_PATH, JSON.stringify({ models: { providers: { kstub: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } } } }));
  require('../modules/harness/catalog').saveConfig('doca', { provider: 'kstub', model: 'm', fallbackChain: [], summarizeAfter: 0, maxSteps: 4 });
});
after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await H.stop(); });

const memory = () => require('../modules/harness/memory');
const use = () => require('../modules/harness/skill-use');
const person = () => require('../modules/harness/turn/client').personById({ id: H.owner.user.id, orgId: H.owner.orgId });
const chat = (title = 'kit') => { const s = memory().createSession(title, { activate: false }); require('../modules/harness/session-access').claim(person(), s.id); return s.id; };
const inProject = id => {
  const dir = fs.mkdtempSync(path.join(H.tmp || require('os').tmpdir(), 'kit-prj-'));
  const p = require('../modules/projects/store').create({ root: dir });
  memory().updateSession(id, { projectId: p.id });
  return p;
};
const turn = (sessionId, message) => require('../modules/harness/agent').turn({ message, sessionId, emit: () => {}, client: { name: 'test', kind: 'browser', user: person() } });
const names = id => use().resolve(id).skills.map(x => `${x.name}:${x.from}`);

test('a mode\'s skills resolve chat → project → hive, and write-good-code only where a repository is', () => {
  const plain = chat();
  assert.deepEqual(names(plain), [], 'a chat about the weather carries no coding rules');
  require('../modules/harness/modes').set(plain, 'plan');
  assert.deepEqual(names(plain), ['plan-well:hive'], 'planning is planning anywhere');
  const id = chat();
  const p = inProject(id);
  assert.deepEqual(names(id), ['write-good-code:hive']);
  require('../modules/harness/modes').set(id, 'debug');
  assert.deepEqual(names(id).sort(), ['debug-method:hive', 'write-good-code:hive']);
  require('../modules/projects/store').update(p.id, { modeSkills: { debug: ['plan-well'] } });
  assert.deepEqual(names(id), ['plan-well:project'], 'the project\'s list for the mode replaces the hive\'s');
  use().setChat(id, { add: ['android-app'], remove: ['plan-well'] });
  assert.deepEqual(names(id), ['android-app:chat']);
  assert.match(use().block(id), /# Skills attached to this conversation \(Debug mode\)[\s\S]*## android-app \(attached by this chat\)/);
  require('../modules/harness/modes').set(id, 'agent');
  require('../modules/projects/store').update(p.id, { modeSkills: null });
  assert.deepEqual(names(id).sort(), ['android-app:chat', 'write-good-code:hive']);
});

test('the hive switches a skill off: out of the manifest, the readings and the skill tool — and on again', async () => {
  const { savePrefs, loadPrefs } = require('../modules/utils');
  savePrefs({ ...loadPrefs(), skillUse: { 'morning-brief': { use: 'off' } } });
  assert.doesNotMatch(require('../modules/harness/skills').manifestBlock(), /morning-brief/);
  assert.match(await require('../modules/harness/tools').call('skill', { action: 'read', name: 'morning-brief' }), /switched off/);
  assert.equal(require('../modules/harness/skill-triggers').match('good morning!').length, 0);
  savePrefs({ ...loadPrefs(), skillUse: { 'morning-brief': { triggers: ['buondì'] } } });
  const s = use().all().find(x => x.name === 'morning-brief');
  assert.equal(s.use, 'fits', 'writing triggers alone keeps how it is used');
  assert.deepEqual(require('../modules/harness/skill-triggers').match('buondì a tutti').map(m => m.name), ['morning-brief']);
  savePrefs({ ...loadPrefs(), skillUse: {} });
});

test('triggers match in any language, written ones before made ones, and reach the readings as one line', () => {
  const tr = require('../modules/harness/skill-triggers');
  assert.equal(tr.said('Mi serve codice pulito per favore', ['codice pulito']), 'codice pulito');
  assert.equal(tr.said('accendi le luci in cucina', ['luci']), 'luci');
  assert.equal(tr.said('ビルドを実行して', ['ビルド']), 'ビルド', 'a script without spaces matches as written');
  assert.equal(tr.said('build it on my phone', ['only a phone']), null, 'only is not on');
  assert.deepEqual(tr.made({ name: 'write-good-code', description: 'Structure is key' }), ['write good code', 'structure']);
  const id = chat();
  const fits = require('../modules/harness/turn/fits').block({ message: 'please build the android apk', schemas: [{ function: { name: 'skill' } }], sessionId: id });
  assert.equal((fits.match(/Suggested by DOCA: skill android-app \(matched "android"\)/g) || []).length, 1);
  use().setChat(id, { add: ['android-app'] });
  assert.doesNotMatch(require('../modules/harness/turn/fits').block({ message: 'please build the android apk', schemas: [{ function: { name: 'skill' } }], sessionId: id }), /android-app/,
    'attached to the chat already: not suggested again');
});

test('a chip\'s skill is written onto the person\'s row once; a dismissed one is not attached', async () => {
  const next = require('../modules/harness/skill-next');
  const id = chat();
  assert.equal(next.auto(id).on, false, 'off by default outside a project');
  next.set(id, { add: ['android-app'] });
  await turn(id, 'make the gradle build work');
  const row = memory().messages(id).find(r => r.role === 'user');
  assert.deepEqual(row.attachedSkills.map(a => a.name), ['android-app']);
  assert.equal(memory().getSession(id).skillsNext, null, 'taken by the turn');
  const p = id2 => { const s = chat(); inProject(s); return s; };
  const auto = p();
  assert.deepEqual(next.auto(auto), { on: true, from: 'a project chat in Agent mode' });
  next.set(auto, { skip: ['android-app'] });
  await turn(auto, 'build the android apk please');
  assert.equal(memory().messages(auto).find(r => r.role === 'user').attachedSkills, undefined, 'dismissed: not attached');
  await turn(auto, 'build the android apk again');
  assert.deepEqual(memory().messages(auto).filter(r => r.role === 'user').pop().attachedSkills.map(a => a.name), ['android-app'], 'the skip was for one message');
  // The chip's logic in the page: a dismissed suggestion is not drawn, so nothing taps it.
  const vm = require('node:vm');
  const ctx = { document: { addEventListener() {} }, escHtml: s => s };
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../public/js/agent-ui/composer-assist.js'), 'utf8')}\n;this.COMPOSER_COMMANDS = COMPOSER_COMMANDS;`, ctx);
  const chips = ctx.composerChips([{ name: 'a' }, { name: 'b' }], { dismissed: new Set(['a']), added: new Set(['b']) });
  assert.deepEqual([...chips].map(c => `${c.name}:${c.state}`), ['b:added']);
  assert.deepEqual([...ctx.COMPOSER_COMMANDS].map(c => c.name), require('../modules/harness/slash').COMMANDS.map(c => c.name), 'the page lists the hub\'s commands');
});

test('the prompt cache holds: the system prompt is the same bytes across steps and turns; a suggestion changes only the tail', async () => {
  const id = chat();
  inProject(id);
  memory().updateSession(id, { skillAuto: false });
  bodies.length = 0;
  await turn(id, 'two-step one');
  await turn(id, 'two-step two');
  const sys = bodies.map(b => b.messages[0].content);
  assert.equal(bodies.length, 4, 'two steps a turn');
  assert.ok(sys.every(s => s === sys[0]), 'one system prompt across two steps and two turns');
  assert.match(sys[0], /# Skills attached to this conversation \(Agent mode\)[\s\S]*## write-good-code/);
  assert.ok(sys[0].indexOf('# Skills — procedures') < sys[0].indexOf('# Skills attached'), 'right after the manifest');
  const tailOf = b => b.messages[b.messages.length - 1].content;
  const plainTail = tailOf(bodies[3]);
  bodies.length = 0;
  await turn(id, 'two-step: build the android apk');
  assert.equal(bodies[0].messages[0].content, sys[0], 'a suggestion leaves the system prompt alone');
  assert.match(tailOf(bodies[0]), /Suggested by DOCA: skill android-app/);
  assert.match(tailOf(bodies[1]), /Suggested by DOCA: skill android-app/, 'the same line each step of the turn');
  const delta = Math.round((tailOf(bodies[0]).length - plainTail.length) / 4);
  console.error(`[chat-kit] a suggestion adds ~${delta} tokens to each step's uncached tail`);
  assert.ok(delta > 0 && delta < 120, `a short line: ${delta} tokens`);
  // Accepted for one message: written once into history, the same bytes on the next step — never re-sent in the tail.
  require('../modules/harness/skill-next').set(id, { add: ['android-app'] });
  bodies.length = 0;
  await turn(id, 'two-step: and the apk once more');
  const userOf = b => b.messages.filter(m => m.role === 'user' && /attached the skill android-app/.test(m.content));
  assert.equal(userOf(bodies[0]).length, 1);
  assert.equal(userOf(bodies[1])[0].content, userOf(bodies[0])[0].content, 'history, cached with the rest');
  assert.doesNotMatch(tailOf(bodies[1]), /attached the skill/, 'not in the readings');
  assert.equal(bodies[0].messages[0].content, sys[0]);
});

test('slash commands: /skill attaches, /loop runs in the same chat until its answer says done, /loop stop ends it', async () => {
  const slash = require('../modules/harness/slash');
  assert.equal(slash.parse('/etc/hosts has a typo'), null, 'a path is a message');
  assert.deepEqual(slash.parse('/loop 10m check the build'), { name: 'loop', args: '10m check the build' });
  const id = chat();
  const r = await turn(id, '/skill write-a-skill');
  assert.equal(r.steps, 0);
  assert.match(r.text, /Attached write-a-skill/);
  assert.deepEqual(names(id), ['write-a-skill:chat']);
  assert.match((await turn(id, '/skill -write-a-skill')).text, /Detached/);
  const loop = require('../modules/schedules/loop');
  assert.throws(() => loop.parse('soon do it'), /interval/);
  assert.deepEqual(loop.parse('2h x5 tidy up'), { when: { every: 120 }, max: 5, prompt: 'tidy up' });
  const started = await require('../modules/harness/agent').send({ message: '/loop self x4 LOOPDONE work on it', sessionId: id, client: { name: 'test', user: person() } });
  assert.match(started.text, /Loop started in this conversation/);
  const sch = require('../modules/schedules');
  const s = loop.forSession(id)[0];
  assert.equal(s.state, 'on', 'the person typed it: on at once');
  await sch.runNow(s.id);
  assert.equal(sch.get(s.id).state, 'on');
  await sch.runNow(s.id);
  assert.equal(sch.get(s.id).state, 'done', 'its answer said done');
  assert.match(sch.get(s.id).last.summary, /Ended: its answer said it is done/);
  const rows = memory().messages(id).filter(r => r.role === 'user').map(r => r.content);
  assert.ok(rows.some(c => /Loop run 2 of at most 4/.test(c)), 'each run is a turn in the same chat');
  await turn(id, '/loop 5m x2 keep going');
  const m = loop.forSession(id)[0];
  await sch.runNow(m.id); await sch.runNow(m.id);
  assert.equal(sch.get(m.id).state, 'done', 'after its maximum');
  await turn(id, '/loop 5m keep going');
  assert.match((await turn(id, '/loop stop')).text, /Stopped the loop/);
  assert.equal(loop.forSession(id).length, 0);
});

test('a chat\'s own compaction overrides the harness for it alone, and /compact folds now', async () => {
  const id = chat();
  const choice = require('../modules/harness/turn/choice');
  const params = require('../modules/harness/turn/params').params();
  const cc = require('../modules/harness/turn/compact-choice');
  cc.set(id, { off: true });
  const off = choice.apply({ ...params, contextWindow: 100000 }, id);
  assert.equal(require('../modules/harness/budget').context(off, 10).compactAt, null, 'the ring has no fold point');
  cc.set(id, { at: 50 });
  assert.equal(require('../modules/harness/budget').context(choice.apply({ ...params, contextWindow: 100000 }, id), 10).compactPercent, 50);
  assert.throws(() => cc.set(id, { at: 5 }), /10 to 95/);
  assert.equal(choice.apply({ ...params, contextWindow: 100000 }, chat()).compactAt, params.compactAt, 'another chat keeps the harness\'s');
  cc.set(id, null);
  for (let i = 0; i < 4; i++) await turn(id, `question ${i}`);
  const r = await turn(id, '/compact');
  assert.match(r.text, /Compacted: \d+ earlier messages/);
  assert.match(memory().getSession(id).summary, /Earlier: the person asked things/);
});

test('a device\'s slash command is the same command', async () => {
  const phone = H.mkDevice('kit phone', 'phone', H.PHONE_CAPS);
  const posted = await H.api(phone.token, 'POST', '/api/v1/harness/messages', { message: '/skill write-a-skill' });
  assert.equal(posted.status, 202);
  for (let i = 0; i < 50 && !memory().messages(posted.body.sessionId).some(r => r.command === 'skill'); i++) await H.sleep(50);
  assert.ok(memory().messages(posted.body.sessionId).some(r => r.command === 'skill' && /Attached write-a-skill/.test(r.content)));
});

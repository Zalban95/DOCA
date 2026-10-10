'use strict';

// What a held tool that is not loaded is for, and the words that call for it (turn/tool-cues.js; asked 2026-10-10:
// "does the orchestrator organically reach everything?"). A request's words load the framework made for it for that
// turn — a reminder, the weather, the Library, a Home Assistant server — and "Likely fits" says so; nothing is
// attached for the conversation until it is called; the named list says each tool's job.

const H = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

before(async () => { await H.start(); });
after(async () => { await H.stop(); });

const schema = (name, description = '') => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } } });

test('a request\'s words call for the tool made for its job, and a greeting calls for none', () => {
  const { cued } = require('../modules/harness/turn/tool-cues');
  const named = ['remind', 'schedule', 'today', 'library_search', 'meeting', 'hub_command', 'chronicle', 'canvas', 'memory_forget', 'secret_use'].map(n => schema(n));
  const ha = ['HassTurnOn', 'HassTurnOff', 'GetLiveContext'].map(n => schema(`mcp__home-assistant__${n}`, 'Turns on/opens/presses a device or entity.'));
  const blender = ['get_scene_info', 'execute_blender_code'].map(n => schema(`mcp__blender__${n}`, 'Blender scene.'));
  const all = [...named, ...ha, ...blender];
  const cases = {
    'Remind me in 20 minutes to take the pasta off the stove.': 'remind',
    'Every Monday at 8, send me the week\'s forecast.': 'schedule',
    'What will the weather be like tomorrow?': 'today',
    'Find the recording where I talked with the builder about the roof.': 'library_search',
    'Set up a video call with marco@example.com tomorrow at 3pm.': 'meeting',
    'Restart the whisper speech service.': 'hub_command',
    'What did you do overnight? Did anything fail?': 'chronicle',
    'Make a bar chart of my monthly spend.': 'canvas',
    'Forget the office router address.': 'memory_forget',
    'Type my home Wi-Fi password on my phone.': 'secret_use',
    'Turn off the living room lights.': 'mcp:home-assistant',
    'Is the front door locked?': 'mcp:home-assistant',
    'Add a red cube to my Blender scene.': 'mcp:blender',
  };
  for (const [text, want] of Object.entries(cases)) assert.ok(cued(text, all).includes(want), `${text} → ${want}: ${cued(text, all)}`);
  assert.deepEqual(cued('hello, how are you?', all), []);
  assert.ok(cued('Remind me, every day, to turn on the lights, forget the rest, check the weather and the calendar, and the logs', all).length <= 6, 'at most six');
});

test('a cued tool is sent for that turn only, Likely fits names it, and the named list says each job', () => {
  const tiers = require('../modules/harness/turn/tool-tiers');
  const fits = require('../modules/harness/turn/fits');
  const memory = require('../modules/harness/memory');
  const s = memory.createSession('cues', { activate: false });
  const held = [schema('read_file'), schema('remind'), schema('today'), schema('chronicle')];
  // (A message naming a tool, "remind", loads it for the conversation as before; a cue is a word for its job.)
  const { offered, named, cued } = tiers.split(held, { sessionId: s.id, text: 'will it rain tomorrow?' });
  assert.ok(offered.some(x => x.function.name === 'today') && cued.includes('today'));
  assert.ok(!tiers.attached(s.id).has('today'), 'not attached for the conversation');
  assert.ok(!tiers.split(held, { sessionId: s.id, text: 'hello' }).offered.some(x => x.function.name === 'today'), 'the next turn does not carry it');
  assert.match(fits.block({ message: 'will it rain tomorrow?', schemas: offered }), /- tool today: weather, today's calendar, what waits for the person — loaded for this request/);
  const line = tiers.namedLine(named);
  assert.match(line, /remind — a reminder at a time, fired by itself/);
  assert.match(line, /chronicle — what happened/);
  assert.match(tiers.namedLine([schema('mcp__home-assistant__HassTurnOn'), schema('mcp__home-assistant__HassTurnOff')]), /mcp:home-assistant — the home — lights, climate/);
});

test('every tool that can be named has a job written for it', () => {
  const { PURPOSE } = require('../modules/harness/turn/tool-cues');
  const { CORE } = require('../modules/harness/turn/tool-tiers');
  const { KIT_OF } = require('../modules/harness/kits');
  const tools = require('../modules/harness/tools');
  const missing = Object.keys(KIT_OF).filter(n => !CORE.has(n) && !PURPOSE[n] && !tools.ALIASES[n]);
  assert.deepEqual(missing, [], 'a named tool with no job is a name the agent cannot place');
});

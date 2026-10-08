'use strict';

/**
 * Labelled cases for `npm run experiment -- system-one` (docs/experiments/system-one.md):
 *   - triage: every evaluation-set case with a `difficulty` (evals/*.json), its prompt and that label;
 *   - front: spoken requests labelled `now` (answered in the call, at once or with a quick action) or `later` (a
 *     piece of work for a work chat) — written for this measurement, kept here so every run asks the same;
 *   - browser: bin/lib/system-one-pages.json, captured from a throwaway panel (system-one-capture.js).
 */
const fs = require('fs');
const path = require('path');

function triage() {
  const dir = path.join(__dirname, '..', '..', 'evals');
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const set = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const c of set.cases || []) if (c.difficulty) out.push({ set: f.replace(/\.json$/, ''), id: c.id, prompt: c.prompt, label: c.difficulty });
  }
  return out;
}

const FRONT = [
  ['now', 'What time is it in Tokyo?'],
  ['now', 'Turn on the kitchen lights.'],
  ['now', 'Remind me to call mum at six.'],
  ['now', 'What\'s the weather tomorrow?'],
  ['now', 'Remember that the spare key is with the neighbour.'],
  ['now', 'How many tablespoons are in a cup?'],
  ['now', 'Set a timer for ten minutes.'],
  ['now', 'Make my phone ring, I can\'t find it.'],
  ['now', 'What\'s on my calendar today?'],
  ['now', 'Play some jazz in the living room.'],
  ['now', 'Who won the match last night?'],
  ['now', 'How do you say good morning in Japanese?'],
  ['now', 'Is the GPU busy right now?'],
  ['later', 'Build me a website for my bakery with an online order form.'],
  ['later', 'Research the best electric cars under forty thousand and write me a comparison.'],
  ['later', 'Go through my inbox and draft replies to everything from this week.'],
  ['later', 'Set up a home media server on the spare machine.'],
  ['later', 'Fix the failing tests in the repository and push the fix.'],
  ['later', 'Plan a two week trip to Japan with hotels and trains, and put it in a document.'],
  ['later', 'Move all my notes from Evernote into the projects folder.'],
  ['later', 'Write a script that backs up my photos every night, and test it.'],
  ['later', 'Compare the three kitchen quotes I sent you and tell me which is the best value.'],
  ['later', 'Find every invoice from last year and total them up by month.'],
  ['later', 'Install Home Assistant and connect my lights to it.'],
  ['later', 'Work out why the watch app crashes when I start a call.'],
].map(([label, prompt]) => ({ label, prompt }));

const browser = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'system-one-pages.json'), 'utf8'));

module.exports = { triage, FRONT, browser };

'use strict';

/**
 * What the work taught about a skill it followed — kept beside the skill, never written into it (the learning loop,
 * learn-loop.js; Hermes Agent improves a skill as it is used). A shipped skill rewritten on this machine would stop
 * receiving its updates, so a lesson is a line in DATA_DIR/skill-lessons/<name>.md, shown under the skill whenever it is
 * read ("## Lessons from work on this machine"), at most 20 a skill, the newest kept, a lesson already there not added
 * twice. A person reads and removes them in that file (or the Skills page's list, later); nothing else changes.
 */
const fs = require('fs');
const path = require('path');

const MAX = 20;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const dir = () => path.join(require('../store').DATA_DIR, 'skill-lessons');
const fileOf = name => path.join(dir(), `${name}.md`);

function list(name) {
  if (!NAME.test(String(name || ''))) return [];
  try { return fs.readFileSync(fileOf(name), 'utf8').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)); } catch { return []; }
}

/** Add lessons (each one line); resolves those added. */
function add(name, lessons, { from = '' } = {}) {
  if (!NAME.test(String(name || ''))) return [];
  const have = list(name), seen = new Set(have.map(l => l.replace(/\s*\(.*\)$/, '').toLowerCase()));
  const fresh = lessons.map(l => String(l).replace(/\s+/g, ' ').replace(/^[-*\d.)\s]+/, '').trim()).filter(l => l && l.length <= 400 && !seen.has(l.toLowerCase()));
  if (!fresh.length) return [];
  require('../secret-scan').guardText(fresh.join('\n'), `lessons for ${name}`, 'Keeping the lesson');
  const day = new Date().toISOString().slice(0, 10);
  const all = [...have, ...fresh.map(l => `${l} (${day}${from ? `, ${from}` : ''})`)].slice(-MAX);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileOf(name), `# Lessons for the skill ${name}\nLearned from work on this machine; shown under the skill when it is read. Remove a line to drop it.\n\n${all.map(l => `- ${l}`).join('\n')}\n`);
  return fresh;
}

/** The section skills.read appends: '' when there are none. */
function note(name) {
  const l = list(name);
  return l.length ? `\n\n## Lessons from work on this machine\n${l.map(x => `- ${x}`).join('\n')}` : '';
}

module.exports = { add, list, note, MAX };

'use strict';

/**
 * What a conversation bound to a project is told about it, in its system
 * prompt: where it works, what the project is, how it builds and tests, what
 * is and is not installed, and how to work in it with the tools it has.
 *
 * Built from the folder at the start of each turn (no stored copy to go stale)
 * and kept short — the commands are named, not explained — because it is in
 * every step's prompt. Cached per project for a minute: inspecting runs a few
 * `--version` probes, and a turn has many steps.
 */
const projects = require('./store');

const _cache = new Map();   // projectId -> { at, text }
const TTL = 60e3;

async function text(p) {
  const hit = _cache.get(p.id);
  if (hit && Date.now() - hit.at < TTL) return hit.text;
  const { info, commands } = await require('./run').commands(p);
  const git = require('./git');
  let g = null;
  try { if (await git.top(p.root)) g = await git.status(p.root); } catch {}
  const missing = [...new Set(commands.flatMap(c => c.missing))];
  const lines = [
    `# Project: ${p.name}`,
    `You work in ${p.root}: your shell and relative paths start there.`,
    `Kind: ${info.kinds.map(k => k.label).join(', ') || 'no build system recognised'}.`
      + (g ? ` Git: branch ${g.branch}${g.ahead ? `, ${g.ahead} ahead` : ''}${g.behind ? `, ${g.behind} behind` : ''}, ${g.files.length} changed file(s).` : ' Not a git repository.'),
    commands.length
      ? `Commands (project action run): ${commands.map(c => `${c.name}${c.missing.length ? ' [missing ' + c.missing.join('+') + ']' : ''}`).join(', ')}.`
      : 'No build or test commands were recognised; ask the owner how it builds.',
    missing.length ? `Not installed here: ${missing.join(', ')} — say so rather than working around it.` : '',
    'How to work here: find code with search_files (not shell grep), change many files with replace_in_files '
      + '(dry run first), read history and changes with git, build and test with project run. Read the '
      + 'repository rules (repo_rules) before your first change. Reporting done is checked, not taken on '
      + 'your word: the project\'s tests are run and every plan step must be done (or blocked, with why); a '
      + 'failed check comes back to you — run the tests yourself first.',
  ].filter(Boolean).join('\n');
  _cache.set(p.id, { at: Date.now(), text: lines });
  return lines;
}

/** The brief for a conversation, or '' when it is not in a project. */
async function forSession(sessionId) {
  const p = projects.forSession(sessionId);
  if (!p) return '';
  try { return await text(p); } catch { return `# Project: ${p.name}\nYou work in ${p.root}.`; }
}

function forget(projectId) { _cache.delete(projectId); }

module.exports = { forSession, text, forget };

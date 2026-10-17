'use strict';

/**
 * A file the agent just wrote, checked for a syntax error at once (Hermes Agent runs diagnostics after each write; a
 * cheaper model often leaves a stray bracket and finds out many steps later, from a test). By the file's kind, with the
 * tools a machine has: JSON parsed here; JavaScript by `node --check` (the package's own type decides module or
 * script); Python by its own parser; a shell script by `bash -n`. A kind with no checker, or a checker that is missing,
 * says nothing. The write already happened: the line only tells the agent to fix it now. Mechanical, a few ms each.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (r.error) return null;   // no such program here
  return r.status === 0 ? '' : String(r.stderr || r.stdout || '').trim();
};
const firstLines = (text, n = 4) => text.split('\n').filter(l => l.trim()).slice(0, n).join(' | ').slice(0, 400);

const CHECKS = {
  '.json': abs => { try { JSON.parse(fs.readFileSync(abs, 'utf8')); return ''; } catch (e) { return e.message; } },
  '.js': abs => run(process.execPath, ['--check', abs]),
  '.mjs': abs => run(process.execPath, ['--check', abs]),
  '.cjs': abs => run(process.execPath, ['--check', abs]),
  '.py': abs => run(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', abs]),
  '.sh': abs => (process.platform === 'win32' ? null : run('bash', ['-n', abs])),
};

/** '' when the file reads clean (or cannot be checked here); otherwise one line to append to the write's result. */
function check(abs) {
  const fn = CHECKS[path.extname(abs).toLowerCase()];
  if (!fn) return '';
  let out = null;
  try { if (fs.statSync(abs).size > 2e6) return ''; out = fn(abs); } catch { return ''; }
  if (!out) return '';
  return `\n⚠ It does not parse — fix it now: ${firstLines(out.replace(new RegExp(abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), path.basename(abs)))}`;
}

module.exports = { check, CHECKS };

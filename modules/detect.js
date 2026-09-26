'use strict';

/**
 * Is it here, and which version: declared, not scripted.
 *
 * Detection used to be a shell line per row (`test -f … && …`, `2>/dev/null`,
 * `| head -1`, `PATH=… pip3 …`), which runs under bash and nowhere else — so
 * on Windows every row read "not installed" whether it was there or not. A row
 * now says what it looks for, and this looks, the same way on every platform:
 *
 *   { file: '/path', gitRev: true }   a file that must exist; its folder's git
 *                                     revision as the version, else "installed"
 *   { bin: 'git', args: ['--version'], stderr?, match?, cwd? }
 *                                     a program on PATH (shell.which, which
 *                                     knows PATHEXT and ~/.local/bin), run
 *                                     directly — no shell — and the first line
 *                                     it prints (stderr too, when `stderr`)
 *   { any: [spec, spec, …] }          the first of them that is found
 *
 * Returns { detected, version } and never throws: a detector that fails is
 * a thing reported absent, with nothing to crash on.
 */
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const shell = require('./shell');

const TIMEOUT = 5000;

function firstLine(s) { return String(s || '').split('\n').map(l => l.trim()).find(Boolean) || ''; }

function runBin(file, args, { cwd, timeout = TIMEOUT } = {}) {
  return new Promise(resolve => {
    execFile(file, args, { cwd, timeout, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function gitRev(dir) {
  const git = shell.which('git');
  if (!git) return null;
  const r = await runBin(git, ['-C', dir, 'log', '-1', '--format=rev %h (%cr)']);
  return r.ok ? firstLine(r.stdout) || null : null;
}

async function detect(spec = {}) {
  try {
    if (spec.any) {
      for (const s of spec.any) {
        const r = await detect(s);
        if (r.detected) return r;
      }
      return { detected: false, version: null };
    }
    if (spec.file) {
      if (!fs.existsSync(spec.file)) return { detected: false, version: null };
      const rev = spec.gitRev ? await gitRev(path.dirname(spec.file)) : null;
      return { detected: true, version: rev || 'installed' };
    }
    if (spec.bin) {
      const file = path.isAbsolute(spec.bin) ? (fs.existsSync(spec.bin) ? spec.bin : null) : shell.which(spec.bin);
      if (!file) return { detected: false, version: null };
      const r = await runBin(file, spec.args || [], { cwd: spec.cwd });
      const text = spec.stderr ? `${r.stdout}\n${r.stderr}` : r.stdout;
      const line = spec.match
        ? String(text).split('\n').map(l => l.trim()).find(l => spec.match.test(l)) || ''
        : firstLine(text);
      if (!r.ok && !spec.stderr) return { detected: false, version: null };
      if (!line || line.toLowerCase() === 'undefined') return { detected: false, version: null };
      return { detected: true, version: line.replace(/^v(?=\d)/, '').slice(0, 60) };
    }
  } catch { /* absent */ }
  return { detected: false, version: null };
}

module.exports = { detect };

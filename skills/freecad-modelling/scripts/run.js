#!/usr/bin/env node
'use strict';

/**
 * Run a FreeCAD Python script headless so that a failure is seen: node run.js SCRIPT.py [ARGS…]
 *
 * freecadcmd given a file runs it twice, swallows its traceback to one line ("Exception while processing file") and
 * exits 0; given a script in /tmp under the snap it runs nothing at all and still exits 0 (round 1, 2026-10-16).
 * This runs the script through `-c` with sys.argv = [SCRIPT, ARGS…] and __name__ == '__main__', prints the full
 * traceback and exits 1 when it raises, and refuses a script where a snap or flatpak FreeCAD cannot see it. The exit
 * code is the script's: 0 done, 1 it raised (the traceback is on stderr), or what it passed to sys.exit.
 *
 * flags (before the script): --freecad PATH (or FREECAD_CMD), --timeout SECONDS (default 600)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WIN = process.platform === 'win32';

function which(name) {
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of String(process.env.PATH || '').split(path.delimiter)) for (const e of exts) {
    const p = path.join(d, name + e);
    try { if (d && fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

function freecad(explicit) {
  if (explicit) return explicit;
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD;
  const named = ['freecadcmd', 'FreeCADCmd', 'freecad.cmd', 'freecad-cmd'].map(which).find(Boolean);
  if (named) return named;
  const pf = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const dirs = d => { try { return fs.readdirSync(d).filter(n => /^FreeCAD/i.test(n)).map(n => path.join(d, n, 'bin', 'FreeCADCmd.exe')); } catch { return []; } };
  return [...(WIN ? pf.flatMap(dirs) : []), '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
    '/snap/bin/freecad.cmd', '/usr/bin/freecadcmd', '/usr/lib/freecad/bin/FreeCADCmd'].find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

/** Why a sandboxed FreeCAD (snap, flatpak) would not see the script, or null. */
function unseen(script, exe) {
  let real = exe;
  try { real = fs.realpathSync(exe); } catch { /* as given */ }
  const sandboxed = /[\/]snap[\/]|flatpak/.test(exe) || /[\/]snap[\/]/.test(real);
  if (!sandboxed) return null;
  const tmp = [os.tmpdir(), '/tmp', '/var/tmp'].map(p => path.resolve(p));
  if (tmp.some(t => script === t || script.startsWith(t + path.sep))) return `${script} is in ${path.dirname(script)}: a snap FreeCAD has a /tmp of its own and would run nothing. Put the script under your home folder (a project, the workspace).`;
  const rel = path.relative(os.homedir(), script);
  if (!rel.startsWith('..') && rel.split(path.sep)[0].startsWith('.')) return `${script} is under a hidden folder at the top of your home (${rel.split(path.sep)[0]}): a snap FreeCAD may not read it. Put it in a project or the workspace.`;
  return null;
}

// The script, its arguments and this bootstrap go in the environment: a word after -c is a file FreeCAD would open
// and run, and code after -c longer than about 250 characters is taken for a file name ("Unknown exception").
// The script runs as the __main__ module with its own path and arguments; a failure prints the whole traceback.
const BOOT = `import sys, traceback, os
_p = os.environ['DOCA_FC_SCRIPT']
sys.argv = [_p] + __import__('json').loads(os.environ.get('DOCA_FC_ARGS') or '[]')
sys.path.insert(0, os.path.dirname(_p))
try:
    exec(compile(open(_p, encoding='utf-8').read(), _p, 'exec'), {'__name__': '__main__', '__file__': _p})
except SystemExit as e:
    sys.stdout.flush(); sys.stderr.flush(); os._exit(e.code if isinstance(e.code, int) else (0 if e.code is None else 1))
except BaseException:
    traceback.print_exc(); sys.stdout.flush(); sys.stderr.flush(); os._exit(1)
sys.stdout.flush(); sys.stderr.flush(); os._exit(0)
`;

function main() {
  const argv = process.argv.slice(2), o = {};
  while (argv[0] && argv[0].startsWith('--')) { const k = argv.shift().slice(2); o[k] = argv.shift(); }
  if (!argv[0]) { process.stderr.write('Usage: node run.js [--freecad PATH] [--timeout S] SCRIPT.py [ARGS…]\n'); return 2; }
  const script = path.resolve(argv[0]);
  if (!fs.existsSync(script)) { process.stderr.write(`run: no such script: ${script}\n`); return 2; }
  const exe = freecad(o.freecad);
  if (!exe) { process.stderr.write('run: FreeCAD is not installed here (its command line: freecadcmd, FreeCADCmd or freecad.cmd). Install FreeCAD 1.0 or later, or pass --freecad PATH.\n'); return 2; }
  const why = unseen(script, exe);
  if (why) { process.stderr.write(`run: ${why}\n`); return 2; }
  const env = { ...process.env, DOCA_FC_SCRIPT: script, DOCA_FC_ARGS: JSON.stringify(argv.slice(1)), DOCA_FC_BOOT: BOOT };
  const r = spawnSync(exe, ['-c', "import os; exec(os.environ['DOCA_FC_BOOT'])"], { cwd: path.dirname(script), env, stdio: ['ignore', 'inherit', 'inherit'],
    timeout: (Number(o.timeout) || 600) * 1000, windowsHide: true });
  if (r.error) { process.stderr.write(`run: ${r.error.code === 'ETIMEDOUT' ? `stopped after ${Number(o.timeout) || 600} s` : r.error.message}\n`); return 1; }
  return r.status ?? 1;
}

process.exitCode = main();

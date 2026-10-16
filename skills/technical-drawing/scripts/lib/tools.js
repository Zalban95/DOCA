'use strict';

/**
 * Finding the programs the drawing template runs — FreeCAD's command line, CADCraft's CLI, a Chromium for the fallback —
 * the same way on Linux, macOS and Windows: an explicit path first (a flag or an environment variable), then PATH,
 * then where each one's own installer puts it, then (CADCraft) where the hub's panel installs Craft apps.
 */
const fs = require('fs');
const path = require('path');

const WIN = process.platform === 'win32';
const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(e => e.toLowerCase()) : [''];

function which(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, name + (WIN && !name.toLowerCase().endsWith(e) ? e : ''));
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

const exists = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
const globDirs = (dir, re) => { try { return fs.readdirSync(dir).filter(n => re.test(n)).sort().reverse().map(n => path.join(dir, n)); } catch { return []; } };

function first(list) { for (const p of list) if (exists(p)) return p; return null; }

function freecad(explicit) {
  if (explicit) return explicit;
  if (process.env.FREECAD_CMD) return process.env.FREECAD_CMD;
  const named = ['freecadcmd', 'FreeCADCmd', 'freecad.cmd', 'freecad-cmd'].map(which).find(Boolean);
  if (named) return named;
  const pf = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  return first([
    ...(WIN ? pf.flatMap(d => globDirs(d, /^FreeCAD/i).map(x => path.join(x, 'bin', 'FreeCADCmd.exe'))) : []),
    '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd', '/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd',
    '/snap/bin/freecad.cmd', '/usr/bin/freecadcmd', '/usr/lib/freecad/bin/FreeCADCmd',
  ]);
}

/** CADCraft's CLI: a flag, CADCRAFT_CLI, PATH, the hub's own install (DOCA_DATA_DIR or a `.doca` folder above), Windows' folder. */
function cadcraft(explicit) {
  if (explicit) return explicit;
  if (process.env.CADCRAFT_CLI) return process.env.CADCRAFT_CLI;
  const onPath = which('cadcraft-cli');
  if (onPath) return onPath;
  const bin = WIN ? 'cadcraft-cli.exe' : 'cadcraft-cli';
  const dataDirs = [process.env.DOCA_DATA_DIR];
  for (let d = __dirname, i = 0; i < 8; i++, d = path.dirname(d)) dataDirs.push(path.join(d, '.doca'));
  for (const data of dataDirs.filter(Boolean)) {
    for (const ver of globDirs(path.join(data, 'apps', 'craft', 'cadcraft'), /./)) {
      const found = (function walk(dir, depth) {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
        for (const e of ents) if (e.isFile() && e.name === bin) return path.join(dir, e.name);
        if (depth < 3) for (const e of ents) if (e.isDirectory()) { const f = walk(path.join(dir, e.name), depth + 1); if (f) return f; }
        return null;
      })(ver, 0);
      if (found) return found;
    }
  }
  return WIN ? first([path.join(process.env.ProgramFiles || 'C:\\Program Files', 'CADCraft', bin)]) : null;
}

function chrome(explicit) {
  if (explicit) return explicit;
  if (process.env.CHROME) return process.env.CHROME;
  const named = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map(which).find(Boolean);
  if (named) return named;
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  // Playwright's own Chromium, where `npx playwright install` puts it.
  const home = require('os').homedir();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? path.join(home, 'Library', 'Caches', 'ms-playwright')
    : WIN ? path.join(process.env.LOCALAPPDATA || home, 'ms-playwright') : path.join(home, '.cache', 'ms-playwright'));
  const pw = globDirs(cache, /^chromium-\d+/).flatMap(d => ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'].map(x => path.join(d, x)));
  return first([
    ...pw,
    ...pf.flatMap(d => [path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]);
}

/** A sans-serif font CADCraft will find on this OS (all ship with the OS or its usual fonts package). */
function sansFont() {
  if (process.platform === 'win32') return 'Arial';
  if (process.platform === 'darwin') return 'Helvetica';
  return 'DejaVu Sans';
}

module.exports = { which, freecad, cadcraft, chrome, sansFont, WIN };

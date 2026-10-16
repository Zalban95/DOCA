'use strict';

/**
 * Blender, ffmpeg and two faces of one sans-serif family, the same way on Linux, macOS and Windows: an explicit path
 * (a flag or an environment variable), then PATH, then where each one's own installer puts it. The fonts are only
 * ones the OS (or its usual font packages) ships — nothing is downloaded or bundled.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIN = process.platform === 'win32';
const exists = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
const dirs = (dir, re) => { try { return fs.readdirSync(dir).filter(n => re.test(n)).sort().reverse().map(n => path.join(dir, n)); } catch { return []; } };

function which(name) {
  const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of String(process.env.PATH || '').split(path.delimiter)) for (const e of exts) if (d && exists(path.join(d, name + e))) return path.join(d, name + e);
  return null;
}

function blender(explicit) {
  if (explicit) return explicit;
  if (process.env.BLENDER) return process.env.BLENDER;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  return which('blender') || [
    ...(WIN ? dirs(path.join(pf, 'Blender Foundation'), /^Blender/i).map(d => path.join(d, 'blender.exe')) : []),
    '/Applications/Blender.app/Contents/MacOS/Blender', '/snap/bin/blender', path.join(os.homedir(), '.local', 'bin', 'blender'),
  ].find(exists) || null;
}

const ffmpeg = explicit => explicit || process.env.FFMPEG || which('ffmpeg') || null;

// Bold and regular pairs, most pleasing first. Lato is OFL (Ubuntu ships it); the rest come with their OS.
const FONTS = [
  ['/usr/share/fonts/truetype/lato/Lato-Bold.ttf', '/usr/share/fonts/truetype/lato/Lato-Regular.ttf'],
  ['/usr/share/fonts/lato/Lato-Bold.ttf', '/usr/share/fonts/lato/Lato-Regular.ttf'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
  ['/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf'],
  ['/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'],
  ['/Library/Fonts/Arial Bold.ttf', '/Library/Fonts/Arial.ttf'],
  ...(WIN ? [['segoeuib.ttf', 'segoeui.ttf'], ['arialbd.ttf', 'arial.ttf']].map(([b, r]) => [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', b), path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', r)]) : []),
];

/** {bold, regular}: the spec's own font files when given, else the first pair this machine has. */
function fonts(spec = {}) {
  if (spec.font_bold && spec.font_regular) return { bold: spec.font_bold, regular: spec.font_regular };
  const pair = FONTS.find(([b, r]) => exists(b) && exists(r));
  if (!pair) throw new Error('No font found for the cards: give "font_bold" and "font_regular" (paths to .ttf files) in the spec.');
  return { bold: pair[0], regular: pair[1] };
}

module.exports = { blender, ffmpeg, fonts, which, FONTS };

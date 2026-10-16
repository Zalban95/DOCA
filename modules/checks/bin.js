'use strict';

/**
 * The programs a check reads a file with (checks/): ffprobe and ffmpeg for video and pictures, tesseract for words on
 * a frame or a page, poppler's pdftotext and pdftoppm for a PDF, and Ghostscript for a page's drawing without its text.
 * Each runs by argv, never through a shell, with a deadline and a cap on what it may print. A program that is not here
 * is named with the System tools row that installs it, so a check says what it could not look at instead of passing.
 */
const { execFile } = require('child_process');

const ROW = { ffprobe: 'ffmpeg', ffmpeg: 'ffmpeg', tesseract: 'tesseract', pdftotext: 'poppler', pdftoppm: 'poppler',
  pdfinfo: 'poppler', gs: 'ghostscript' };

const _found = new Map();
/** The program's path, or null; looked up once per process (a check runs often, PATH changes rarely). */
function find(name) {
  // Ghostscript's console program is gswin64c on Windows.
  if (!_found.has(name)) _found.set(name, require('../shell').which(name) || (name === 'gs' && process.platform === 'win32' ? require('../shell').which('gswin64c') : null) || null);
  return _found.get(name);
}

/** "tesseract (Settings → System → System tools → tesseract)" — what to install for a check that could not look. */
const missing = name => `${name} is not on this machine (Settings → System → System tools → ${ROW[name] || name})`;

/** Run a program and hand back what it printed, as bytes. Rejects with the program's own words when it fails. */
function run(name, args, { input = null, timeoutMs = 60000, maxBuffer = 256 << 20 } = {}) {
  const exe = find(name);
  if (!exe) return Promise.reject(Object.assign(new Error(missing(name)), { missing: name }));
  return new Promise((resolve, reject) => {
    const child = execFile(exe, args, { encoding: 'buffer', timeout: timeoutMs, maxBuffer, windowsHide: true }, (err, out, errOut) => {
      if (err) return reject(new Error(`${name}: ${String(errOut || '').trim().split('\n').pop() || err.message}`));
      resolve(out);
    });
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

/** For tests: forget what was found (a test hides a program by changing PATH). */
const reset = () => _found.clear();

module.exports = { find, run, missing, reset, ROW };

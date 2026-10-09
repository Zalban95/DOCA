'use strict';

/**
 * Settings → General → Updates → Install from a file (public/js/settings/update-file.js), production and development:
 *
 *   GET  /api/update/file              what an update file is waiting for, and how the last switch went
 *   POST /api/update/file[?older=1]    the file as the request's body (application/octet-stream): checked, staged, and
 *                                      switched to once nothing runs (from-file.js); older=1 is the person's "go back"
 *   POST /api/update/file/cancel       call a waiting one off (it stays staged)
 *
 * A host's alone (auth/rights.js), and installing asks for the password every time (auth/guarded.js): a version is
 * every guard at once, as /api/versions/use is. The body is streamed to a file under the data folder, never held in
 * memory, and removed once read.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ff = require('./from-file');

const MAX = 8 * 1024 ** 3;   // the code is megabytes; a file carrying an image is larger, and only its host reads that part

function receive(req, dest) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX) return reject(Object.assign(new Error(`The file is over ${MAX / 1024 ** 3} GB.`), { status: 413 }));
    const out = fs.createWriteStream(dest);
    let got = 0;
    req.on('data', d => { got += d.length; if (got > MAX) { req.destroy(); out.destroy(); reject(Object.assign(new Error('The file is too large.'), { status: 413 })); } });
    req.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve(got));
    req.pipe(out);
  });
}

function mount(app) {
  app.get('/api/update/file', (req, res) => res.json(ff.status()));
  app.post('/api/update/file/cancel', (req, res) => res.json(ff.cancel()));
  app.post('/api/update/file', async (req, res) => {
    fs.mkdirSync(ff.uploads(), { recursive: true });
    const tmp = path.join(ff.uploads(), `upload-${crypto.randomBytes(6).toString('hex')}.dupd`);
    try {
      const got = await receive(req, tmp);
      if (!got) return res.status(400).json({ error: 'No file arrived: send the update file as the request body.' });
      const by = req.auth?.user?.name || req.auth?.user?.email || 'a person';
      res.json(await ff.install(tmp, { older: req.query.older === '1', by }));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message, code: e.code || null });
    } finally { fs.rmSync(tmp, { force: true }); }
  });
}

module.exports = { mount, MAX };

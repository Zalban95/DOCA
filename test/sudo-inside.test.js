'use strict';

// An installer that calls sudo itself gets the password the person typed (2026-10-13: Ollama's install.sh answered
// "sudo: A terminal is required to authenticate" — only the sudo words in our own command were given -A). Nothing here
// runs sudo: the script only looks at which sudo it would call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { streamCmd } = require('../modules/utils');
const shell = require('../modules/shell');

function run(cmd, opts) {
  return new Promise(resolve => {
    let out = '';
    const res = { setHeader() {}, writeHead() {}, flushHeaders() {}, on() {}, write: d => { out += String(d); return true; }, end: () => resolve(out) };
    streamCmd(res, cmd, opts);
  });
}
const text = out => out.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)).status || '').join('');

// Linux only: where a vendor's script calls sudo (Ollama's install.sh). On macOS CI the script found /usr/bin/sudo
// before the shim (2026-10-13, cause not found); a Mac installs through Homebrew, which refuses sudo.
const linux = process.platform === 'linux' && !!shell.which('sudo');
test('a script\'s own sudo asks the same helper, and the helper is gone afterwards', { skip: !linux }, async () => {
  const out = text(await run('s=$(command -v sudo); echo "SUDO=$s"; cat "$s"; echo "ASK=$SUDO_ASKPASS"', { password: 'pw' }));
  const at = /SUDO=(\S+)/.exec(out)[1];
  assert.match(out, /exec '.*sudo' -A "\$@"/, 'the sudo a script finds hands every call to the real one with -A');
  assert.equal(fs.existsSync(at), false, 'and nothing of it is left once the command ends');
  assert.equal(fs.existsSync(/ASK=(\S+)/.exec(out)[1]), false);
});

test('without a password nothing is put in front of sudo', { skip: shell.WIN || !shell.which('sudo') }, async () => {
  const out = text(await run('command -v sudo', {}));
  assert.ok(out.split('\n').includes(shell.which('sudo')), out);
});

'use strict';

// Every glyph the panel draws has a font in the agents' computer (self-test 2026-10-08, #26: ⧉ and the ＋ of the skill
// and recipe buttons were boxes in its Chromium, so the agents' screenshots of the panel misread it). Runs against
// the computer image only when it was built from this source (its doca.computer.source label), since an older image
// is expected to lack what was added since; DOCA_COMPUTER_IMAGE names another image to check.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** The non-ASCII code points in the panel's pages, scripts and styles (spacing, joiners and variation selectors aside). */
function glyphs() {
  const out = new Set();
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css)$/.test(e.name))
        for (const ch of fs.readFileSync(p, 'utf8')) {
          const o = ch.codePointAt(0);
          if (o > 0x206f && !(o >= 0xfe00 && o <= 0xfe0f)) out.add(o.toString(16));
        }
    }
  };
  walk(path.join(__dirname, '..', 'public'));
  return [...out].sort();
}

test('the computer image has a font for every glyph the panel draws', t => {
  const computers = require('../modules/computers');
  const cli = require('../modules/containers').cli();
  const image = process.env.DOCA_COMPUTER_IMAGE || computers.IMAGE;
  let labels;
  try { labels = JSON.parse(execFileSync(cli, ['image', 'inspect', '--format', '{{ json .Config.Labels }}', image], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || 'null') || {}; }
  catch { return t.skip(`no ${image} image here`); }
  if (!process.env.DOCA_COMPUTER_IMAGE && labels['doca.computer.source'] !== computers.sourceHash())
    return t.skip(`${image} was built from older computer code; Computers → Rebuild the image to check it`);
  const list = glyphs();
  assert.ok(list.length > 100, 'the walk found the panel\'s glyphs');
  const missing = execFileSync(cli, ['run', '--rm', '-i', '--user', 'root', '--entrypoint', 'sh', image, '-c',
    'while read c; do [ -n "$(fc-list ":charset=$c" family)" ] || printf "%s " "$c"; done'], { input: list.join('\n') + '\n', encoding: 'utf8' }).trim();
  assert.equal(missing, '', `no font in ${image} for U+${missing.split(' ').join(', U+')}`);
});

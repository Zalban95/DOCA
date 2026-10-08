'use strict';
/**
 * The Windows installer has to run in Windows PowerShell 5.1 — the `powershell` every Windows 10 and 11 has — not only
 * in PowerShell 7, which CI's `pwsh` is. Three things broke it there and nowhere else (H1.9, a real Windows 11 host,
 * 2026-10-08); each is held here, since a test on Linux can still read the script.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'scripts');
const scripts = fs.readdirSync(DIR).filter(f => /\.ps1$/i.test(f)).map(f => [f, fs.readFileSync(path.join(DIR, f))]);

test('a PowerShell script is ASCII (or carries a BOM): 5.1 reads a BOM-less file as ANSI', () => {
  assert.ok(scripts.length, 'scripts/install.ps1 is there');
  for (const [f, buf] of scripts) {
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    // The UTF-8 bytes of "→" end in 0x92, which cp1252 reads as a closing quote — and PowerShell then reads it as one.
    const at = buf.findIndex(b => b > 0x7f);
    assert.ok(bom || at < 0, `${f} has a non-ASCII byte at ${at}: ${buf.slice(Math.max(0, at - 30), at + 10).toString()}`);
  }
});

test('no double quotes inside an argument to a native program, and no scriptblock certificate callback', () => {
  for (const [f, buf] of scripts) {
    const text = buf.toString();
    // 5.1 drops them on the way to the program: node -e 'split(".")' reached node as split(.), so every Node read as too old.
    assert.doesNotMatch(text, /&\s*node\s+-[ep]\s+'[^']*"/, `${f}: a quoted string inside node -e/-p`);
    // 5.1 runs a scriptblock callback on the TLS thread, where there is no runspace: the self-signed panel never answered.
    assert.doesNotMatch(text, /ServerCertificateValidationCallback\s*=\s*\{/, `${f}: a scriptblock certificate callback`);
  }
});

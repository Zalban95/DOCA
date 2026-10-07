'use strict';

/**
 * DOCA is a product, not anyone's personal setup (CONSTITUTION §0; TODO P0.1): what one installation has — its paths,
 * hosts, accounts, models, providers — is never in what the project ships. This fails on such a string in shipped code,
 * pages, skills, scripts and clients. Allowed: identifiers that cannot change on installed apps (the Android package),
 * the project's own repository until it is a setting, and a person named as attribution in a comment.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHIPPED = ['modules', 'public', 'skills', 'bin', 'clients', 'scripts', 'server.js', 'evals'];
// One installation's specifics, as they have turned up here.
const PERSONAL = [/\/media\/al\b/, /\/home\/al\b/, /\bal-office/i, /tail08f157/, /pesciegatto/i, /\bDeepSeek4f\b/, /qwen3\.8-27b/,
  /\bportal\/</, /\bportal PC\b/i, /D:\\\\?doca/i];
const ALLOWED = [
  { file: /modules\/models-llamacpp\.js$/, re: /\/media\/al/ },   // a comment recording the hardcoded instance that was removed
];

function walk(p, out = []) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return out;
  if (fs.statSync(abs).isFile()) return out.concat(p);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (['node_modules', 'vendor', '.git'].includes(e.name) || /\.(png|jpe?g|gif|webp|onnx|zip|dpack|woff2?|ttf|ico|svg)$/i.test(e.name)) continue;
    walk(path.join(p, e.name), out);
  }
  return out;
}

test('nothing shipped carries one installation\'s paths, hosts, accounts or models', () => {
  const found = [];
  for (const f of SHIPPED.flatMap(p => walk(p))) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const re of PERSONAL) {
      if (!re.test(text)) continue;
      if (ALLOWED.some(a => a.file.test(f.split(path.sep).join('/')) && a.re.source === re.source)) continue;
      found.push(`${f}: ${re}`);
    }
  }
  assert.deepEqual(found, [], 'personal to one installation — move it to that install\'s settings (CONSTITUTION §0)');
});

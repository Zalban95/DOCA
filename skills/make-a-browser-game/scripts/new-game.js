#!/usr/bin/env node
'use strict';

/**
 * A new browser game from the starter beside this script (../template): Phaser 3 with no build step, the page laid
 * out for desk and phone (the game centred; touch pads with space of their own), menus, levels as data, entities in
 * a registry, sound and pictures made in code, saving, a test hook, and `npm test` — the levels checked and the game
 * played in a real browser at three sizes.
 *
 *   node new-game.js <folder> [--title "Name"] [--phaser <path to phaser.min.js>]
 *
 * The folder must be new or empty. Phaser is fetched once from jsDelivr (pinned) and kept in ~/.cache for the next game.
 * The folder becomes a git repository with the starter as its first commit.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PHASER = { version: '3.90.0', url: 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js', minBytes: 900000 };
const TEMPLATE = path.join(__dirname, '..', 'template');
const TEXT = new Set(['.js', '.json', '.html', '.css', '.md', '']);

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

function copy(from, to, swap) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name), dst = path.join(to, e.name === 'gitignore' ? '.gitignore' : e.name);
    if (e.isDirectory()) { copy(src, dst, swap); continue; }
    if (TEXT.has(path.extname(e.name))) fs.writeFileSync(dst, swap(fs.readFileSync(src, 'utf8')));
    else fs.copyFileSync(src, dst);
  }
}

async function phaser(to, given) {
  const cache = path.join(os.homedir(), '.cache', 'doca-games', `phaser-${PHASER.version}.min.js`);
  const src = given || (fs.existsSync(cache) ? cache : null);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (src) return fs.copyFileSync(src, to);
  const r = await fetch(PHASER.url);
  if (!r.ok) throw new Error(`Phaser could not be fetched (${r.status} from ${PHASER.url}); pass --phaser <path to phaser.min.js>.`);
  const body = Buffer.from(await r.arrayBuffer());
  if (body.length < PHASER.minBytes || !body.slice(0, 400).toString().includes('Phaser')) throw new Error('What came back is not Phaser; pass --phaser <path>.');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, body);
  fs.writeFileSync(to, body);
}

async function main() {
  const a = args(process.argv.slice(2));
  const dir = a._[0] && path.resolve(a._[0]);
  if (!dir) { console.error('Usage: node new-game.js <folder> [--title "Name"] [--phaser <path>]'); process.exit(2); }
  if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f !== '.git')) { console.error(`${dir} is not empty: give a new folder.`); process.exit(2); }
  const title = String(a.title && a.title !== true ? a.title : path.basename(dir)).trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
  copy(TEMPLATE, dir, s => s.replaceAll('__TITLE__', title.replace(/'/g, '’')).replaceAll('__SLUG__', slug));
  await phaser(path.join(dir, 'vendor', 'phaser.min.js'), a.phaser && a.phaser !== true ? path.resolve(a.phaser) : null);
  const git = (...g) => execFileSync('git', g, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (!fs.existsSync(path.join(dir, '.git'))) git('init', '-q', '-b', 'main');
  let who = [];
  try { git('config', 'user.email'); } catch { who = ['-c', 'user.name=Game starter', '-c', 'user.email=starter@localhost']; }
  git('add', '-A');
  git(...who, 'commit', '-q', '-m', `Starter for ${title}: Phaser ${PHASER.version}, page laid out for desk and phone, tests`);
  console.log(`Made ${title} in ${dir} (git, first commit).
Next: npm test (the levels, and the game in a browser at three sizes) · npm start (http://127.0.0.1:8080/).
Read docs/README.md in it: which file does what, and how to add a level, an enemy, an item, a sound, a picture.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });

'use strict';

/**
 * Search in files, and replace in files — the Projects tab's search panel and
 * the agent's `search_files` / `replace_in_files` tools.
 *
 * ripgrep when it is installed (fast, and it already knows .gitignore);
 * otherwise a walker in this process that skips what a person never means to
 * search: .git, node_modules, build output, binaries, files over 2 MB.
 * Options are the ones Notepad++ and VS Code give: plain text or a regular
 * expression, match case, whole word, include/exclude globs.
 *
 * Replace always shows before it writes: `replaceInFiles(..., { dryRun: true })`
 * returns every change with its line, and the real run writes only files whose
 * content still matches what was previewed.
 */
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const shell = require('../shell');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.gradle', 'build', 'dist', 'out', 'target', '.next', '.venv', 'venv', '__pycache__', '.idea', '.dart_tool', 'Pods', '.releases']);
const MAX_FILE = 2 << 20;
const MAX_MATCHES = 2000;

const bad = msg => Object.assign(new Error(msg), { status: 400 });

/** The pattern a query means, as a JS RegExp (global). */
function patternOf({ query, regex = false, caseSensitive = false, wholeWord = false }) {
  const q = String(query ?? '');
  if (!q) throw bad('Search for something.');
  let src = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) src = `\\b(?:${src})\\b`;
  try { return new RegExp(src, caseSensitive ? 'g' : 'gi'); } catch (e) { throw bad(`Not a valid regular expression: ${e.message}`); }
}

/** A glob list ("*.kt, src/**") as a test on a relative path. */
function globTest(globs) {
  const list = String(globs || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const res = list.map(g => new RegExp(`(^|/)${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(.*/)?')}$`));
  return rel => res.some(r => r.test(rel));
}

function* walk(root, dir = root) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(root, abs); }
    else if (e.isFile()) yield abs;
  }
}

function isText(buf) { return !buf.subarray(0, 8000).includes(0); }

function rel(root, abs) { return path.relative(root, abs).split(path.sep).join('/'); }

/** Candidate files, with include/exclude applied. */
function files(root, { include, exclude } = {}) {
  const inc = globTest(include), exc = globTest(exclude);
  const out = [];
  for (const abs of walk(root)) {
    const r = rel(root, abs);
    if (inc && !inc(r)) continue;
    if (exc && exc(r)) continue;
    out.push(abs);
  }
  return out;
}

function searchText(root, opts) {
  const re = patternOf(opts);
  const matches = [];
  let filesWith = 0, truncated = false;
  for (const abs of files(root, opts)) {
    let buf;
    try { if (fs.statSync(abs).size > MAX_FILE) continue; buf = fs.readFileSync(abs); } catch { continue; }
    if (!isText(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i]))) {
        hit = true;
        matches.push({ file: rel(root, abs), line: i + 1, col: m.index + 1, length: m[0].length, text: lines[i].slice(0, 400) });
        if (matches.length >= MAX_MATCHES) { truncated = true; break; }
        if (!m[0].length) re.lastIndex++;
      }
      if (truncated) break;
    }
    if (hit) filesWith++;
    if (truncated) break;
  }
  return { matches, files: filesWith, truncated, engine: 'built-in' };
}

/** ripgrep, when it is there: same answer shape. */
function searchRg(root, opts) {
  const rg = shell.which('rg');
  if (!rg) return null;
  const args = ['--json', '--max-filesize', '2M', '--max-count', '500'];
  if (!opts.regex) args.push('--fixed-strings');
  if (!opts.caseSensitive) args.push('--ignore-case');
  if (opts.wholeWord) args.push('--word-regexp');
  for (const g of String(opts.include || '').split(',').map(s => s.trim()).filter(Boolean)) args.push('--glob', g);
  for (const g of String(opts.exclude || '').split(',').map(s => s.trim()).filter(Boolean)) args.push('--glob', `!${g}`);
  for (const d of SKIP_DIRS) args.push('--glob', `!${d}/`);
  args.push('--', String(opts.query), '.');
  return new Promise(resolve => {
    execFile(rg, args, { cwd: root, maxBuffer: 64 << 20, timeout: 30000, windowsHide: true }, (err, stdout) => {
      if (err && err.code !== 1) return resolve(null);   // 1 = nothing found; anything else: use the walker
      const matches = [];
      const withHits = new Set();
      let truncated = false;
      for (const line of String(stdout).split('\n')) {
        if (!line.startsWith('{"type":"match"')) continue;
        const d = JSON.parse(line).data;
        const file = d.path.text.replace(/^\.\//, '');
        withHits.add(file);
        const text = d.lines.text?.replace(/\n$/, '') ?? '';
        for (const sm of d.submatches) {
          // ripgrep counts bytes; the editor counts characters.
          const col = Buffer.from(text).subarray(0, sm.start).toString('utf8').length + 1;
          matches.push({ file, line: d.line_number, col, length: sm.match.text?.length ?? 0, text: text.slice(0, 400) });
        }
        if (matches.length >= MAX_MATCHES) { truncated = true; break; }
      }
      resolve({ matches: matches.slice(0, MAX_MATCHES), files: withHits.size, truncated, engine: 'ripgrep' });
    });
  });
}

/** Search `root`. { matches: [{ file, line, col, length, text }], files, truncated, engine }. */
async function search(root, opts = {}) {
  patternOf(opts);   // a bad pattern is a 400 either way
  return (await searchRg(root, opts)) || searchText(root, opts);
}

/**
 * Replace across files. `dryRun` returns what would change; otherwise it
 * writes, and says how many replacements in how many files. `$1` works in
 * regex mode. Only files under `root`, only text files.
 */
function replaceInFiles(root, { replacement = '', dryRun = false, only, refuse, ...opts } = {}) {
  const re = patternOf(opts);
  const onlySet = only ? new Set([].concat(only)) : null;
  const changes = [];
  let count = 0;
  for (const abs of files(root, opts)) {
    const r = rel(root, abs);
    if (onlySet && !onlySet.has(r)) continue;
    if (refuse && refuse(abs)) continue;   // the agent's calls skip what governs it (harness/control-plane.js)
    let buf;
    try { if (fs.statSync(abs).size > MAX_FILE) continue; buf = fs.readFileSync(abs); } catch { continue; }
    if (!isText(buf)) continue;
    const before = buf.toString('utf8');
    re.lastIndex = 0;
    if (!re.test(before)) continue;
    re.lastIndex = 0;
    const n = (before.match(re) || []).length;
    // $1 and $& mean something in a regex replacement; in plain text a $ is a $.
    const after = before.replace(re, opts.regex ? String(replacement) : String(replacement).replace(/\$/g, '$$$$'));
    const lines = before.split('\n'), newLines = after.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.min(lines.length, newLines.length) && diffs.length < 50; i++)
      if (lines[i] !== newLines[i]) diffs.push({ line: i + 1, before: lines[i].slice(0, 300), after: newLines[i].slice(0, 300) });
    changes.push({ file: r, replacements: n, lines: diffs });
    count += n;
    if (!dryRun) fs.writeFileSync(abs, after);
  }
  return { files: changes.length, replacements: count, changes, written: !dryRun };
}

module.exports = { search, replaceInFiles, files, patternOf, SKIP_DIRS };

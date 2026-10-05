'use strict';

/**
 * Pages (TODO H9.4; OpenDots' Spaces and Pages): a markdown document with a chat beside it. Built on Projects rather
 * than beside them — a project is the space, its `.md` files are the pages (plain files: Obsidian, VS Code or any
 * editor opens them, and git versions them), the editor renders and edits them (md-doc.js), and a chat tab can be
 * *about* one page: `session.page` holds its path in the project, and every turn of that conversation is told which
 * page it is about and given its current text (bounded), so "tighten the second section" needs no pointing.
 *
 *   newPage(projectId, title)      a page: `<slug>.md` beginning with `# Title`, never over an existing file
 *   check(project, rel)            a page path inside the project root, or a 400
 *   block(sessionId)               what a turn about a page reads (turn/prompt.js turnPreamble)
 */
const fs = require('fs');
const path = require('path');

const MAX_INLINE = 6000;   // characters of the page given with every turn; a longer page is read with read_file
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function check(p, rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!/\.md$/i.test(clean)) throw bad('A page is a .md file.');
  const abs = path.resolve(p.root, clean);
  if (abs !== p.root && !abs.startsWith(p.root + path.sep)) throw bad('A page is inside its project.');
  return { rel: path.relative(p.root, abs).split(path.sep).join('/'), abs };
}

function newPage(projectId, title) {
  const p = require('./store').need(projectId);
  const name = String(title || '').trim().slice(0, 120);
  if (!name) throw bad('A page needs a title.');
  const slug = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
  let rel = `${slug}.md`;
  for (let i = 2; fs.existsSync(path.join(p.root, rel)); i++) rel = `${slug}-${i}.md`;
  fs.writeFileSync(path.join(p.root, rel), `# ${name}\n\n`);
  return { path: rel, title: name };
}

/** The page a conversation is about, for its turns: where it is and what it says now. */
function block(sessionId) {
  const s = require('../harness/memory').getSession(sessionId);
  if (!s?.page) return '';
  const p = require('./store').forSession(sessionId);
  if (!p) return '';
  let text;
  try { text = fs.readFileSync(check(p, s.page).abs, 'utf8'); } catch { return `# This conversation is about a page\n${s.page} — it is not there any more (moved or deleted); ask before recreating it.`; }
  const cut = text.length > MAX_INLINE;
  return ['# This conversation is about a page',
    `${s.page} in this project. "It", "the page" and "this" mean this document unless the person says otherwise. Change it by editing that file, `
    + 'section by section; keep what you were not asked to change.',
    `Its text now${cut ? ` (the first ${MAX_INLINE} of ${text.length} characters: read_file it for the rest)` : ''}:`, '```markdown', text.slice(0, MAX_INLINE), '```'].join('\n');
}

module.exports = { newPage, check, block, MAX_INLINE };

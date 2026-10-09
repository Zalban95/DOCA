'use strict';

/**
 * What a version added or fixed (asked 2026-10-06: "in the versions … an info button that lets us see what was added
 * or repaired"), read from git rather than written twice: the version's annotated tag message, and every commit
 * between it and the version before (merges and the bare version bump left out), each with its subject and the body
 * that says why — attribution lines removed. Cached per tag: a tag never changes.
 */
const TAG = /^v\d+\.\d+\.\d+$/;
const _notes = new Map();

async function notes(tag) {
  if (!TAG.test(String(tag || ''))) throw Object.assign(new Error('A version is written vX.Y.Z.'), { status: 400 });
  if (_notes.has(tag)) return _notes.get(tag);
  // A production hive has no git: a signed release's notes are in its manifest (update-channel/stage.js).
  if (require('./edition-mode').production()) {
    const m = require('./update-channel/stage').verified(require('path').join(require('./releases').DIR, tag));
    if (!m) throw Object.assign(new Error(`No signed version ${tag} here.`), { status: 404 });
    return { tag, previous: null, message: String(m.manifest.notes || '').trim(), changes: [] };
  }
  const r = require('./releases');
  const tags = (await r.list()).versions.map(v => v.tag).filter(t => TAG.test(t));   // newest first
  let all = tags;
  try { all = (await gitOut(['tag', '-l', 'v*'])).split('\n').filter(t => TAG.test(t)).sort((a, b) => r.cmpVersion(b, a)); } catch { /* the listed ones */ }
  const i = all.indexOf(tag);
  if (i < 0) throw Object.assign(new Error(`No version ${tag} here.`), { status: 404 });
  const prev = all[i + 1] || null;
  const message = (await gitOut(['tag', '-l', '--format=%(contents)', tag]).catch(() => '')).trim();
  const log = await gitOut(['log', '--no-merges', '--format=%s%x1f%b%x1e', prev ? `${prev}..${tag}` : tag, '-n', '200']).catch(() => '');
  const changes = log.split('\x1e').map(s => s.trim()).filter(Boolean).map(s => {
    const [subject, body = ''] = s.split('\x1f');
    return { subject: subject.trim(), body: body.split('\n').filter(l => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l.trim())).join('\n').trim() };
  }).filter(c => !/^\[\d+\.\d+\.\d+\]/.test(c.subject) || c.body);
  const out = { tag, previous: prev, message, changes };
  _notes.set(tag, out);
  return out;
}

const gitOut = args => require('./releases').git(args, { timeout: 15000 });

/** The notes as markdown, for the panel's document window. */
function markdown(n) {
  return [`# ${n.tag}`, n.message ? `**${n.message}**` : '', n.previous ? `_Since ${n.previous}._` : '',
    ...n.changes.map(c => `### ${c.subject}\n\n${c.body}`)].filter(Boolean).join('\n\n');
}

function mount(app) {
  app.get('/api/versions/:tag/notes', async (req, res) => {
    try { const n = await notes(req.params.tag); res.json({ ...n, markdown: markdown(n) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { notes, markdown, mount };

'use strict';

/**
 * The Library's routes (docs/experiments/library.md). Setting it up, indexing and emptying it are a host's (the
 * folders are this machine's); searching, files like this one and opening a result are anyone's who chats, each
 * answering to search.js's one rule of which folders a person may search.
 */
const path = require('path');
const h = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const person = req => require('../harness/turn/client').dashboardClient(req).user || null;
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const KINDS = ['documents', 'images', 'audio', 'video'];

/** What the Ollama on this machine says about the model: its version (the model needs 0.36) and whether it is pulled. */
async function ollamaSays(cfg) {
  if (cfg.provider !== 'ollama') return null;
  const base = require('../harness/providers').ollamaBase();
  const get = u => fetch(`${base}${u}`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()).catch(() => null);
  const [v, tags] = await Promise.all([get('/api/version'), get('/api/tags')]);
  if (!v) return { reachable: false, url: base };
  const names = (tags?.models || []).map(m => m.name);
  const want = cfg.model && (cfg.model.includes(':') ? cfg.model : `${cfg.model}:latest`);
  const [maj, min] = String(v.version || '0.0').split('.').map(Number);
  return { reachable: true, url: base, version: v.version, newEnough: maj > 0 || min >= 36, pulled: !!want && names.includes(want), models: names.filter(n => /embed/i.test(n)) };
}

async function view(brief = false) {
  if (brief) return { experiment: require('../experiments').on('library'), on: require('.').on(), kinds: require('../settings-schema').value('library.kinds') };
  const E = require('./embed'), I = require('./indexer'), M = require('./media'), sc = require('../settings-schema');
  const cfg = E.settings();
  const leaves = Object.fromEntries(['folders', 'open', 'kinds', 'when', 'everyHours', 'captions', 'tags', 'transcribe'].map(k => [k, sc.value(`library.${k}`)]));
  let local = true;
  try { local = require('../harness/providers').endpoint(cfg.provider).local; } catch { /* named below */ }
  const stt = require('../chat').loadVoiceServices();
  return {
    developer: require('../experiments').developer(), experiment: require('../experiments').on('library'), on: require('.').on(),
    settings: { ...cfg, ...leaves }, local, run: I.view(), lastRun: require('.').lastRun(), watching: require('.').watching(),
    index: await require('./store').stats(), have: { ...M.have(), stt: !!stt.sttUrl, vision: !!sc.value('vision.model') },
    captions: require('./captions').why(), vocabulary: require('./tags').vocabulary().length, ollama: await ollamaSays(cfg),
    folderNotes: leaves.folders.filter(f => !require('./scan').allowedFolder(f)).map(f => ({ folder: f, why: 'not inside the Files roots, protected, or gone' })),
  };
}

/** Settings the section saves; each checked, folders against the Files roots. */
function save(b) {
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs(), next = { ...(prefs.library || {}) };
  for (const k of ['provider', 'model']) if (typeof b[k] === 'string') {
    if (b[k] && !/^[\w.:/@-]{1,120}$/.test(b[k].trim())) throw bad(`${k} is a name: letters, digits and . : / @ - _`);
    next[k] = b[k].trim();
  }
  if (b.folders !== undefined) {
    if (!Array.isArray(b.folders)) throw bad('folders is a list of paths');
    const scan = require('./scan');
    const refused = b.folders.filter(f => !scan.allowedFolder(f));
    if (refused.length) throw bad(`Not a folder the Library may read (inside the Files roots, not protected): ${refused.join(', ')}`);
    next.folders = [...new Set(b.folders.map(f => path.resolve(f)))];
  }
  if (b.open !== undefined) next.open = (Array.isArray(b.open) ? b.open : []).map(f => path.resolve(String(f))).filter(f => (next.folders || []).includes(f));
  if (b.kinds !== undefined) next.kinds = (Array.isArray(b.kinds) ? b.kinds : []).filter(k => KINDS.includes(k));
  if (b.when !== undefined) { if (!['demand', 'schedule', 'watch'].includes(b.when)) throw bad('when is demand, schedule or watch'); next.when = b.when; }
  if (b.captions !== undefined) next.captions = b.captions === true;
  if (b.tags !== undefined) next.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags).split(',')).map(t => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 200);
  if (b.dialect !== undefined) { if (!['ollama', 'openai'].includes(b.dialect)) throw bad('dialect is ollama or openai'); next.dialect = b.dialect; }
  savePrefs({ ...prefs, library: next });
  return view();
}

async function file(req, res) {
  const it = await require('./search').mayOpen(person(req), req.query.path);
  if (!it) return res.status(404).json({ error: 'Not a file of the Library you may open.' });
  const M = require('./media');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  const at = req.query.frame != null ? Number(req.query.frame) : null;
  if ((req.query.thumb || at != null) && M.have().ffmpeg && (it.kind === 'images' || it.kind === 'video')) {
    try {
      const jpeg = await M.picture(it.path, { at: Number.isFinite(at) ? at : it.kind === 'video' ? 1 : null, size: 320 });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.end(jpeg);
    } catch { /* fall back to the file itself */ }
  }
  res.setHeader('Content-Type', require('../attachments').mimeFor(it.path));
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(it.path).replace(/"/g, '')}"`);
  res.sendFile(it.path);
}

function mount(app) {
  app.get('/api/library', h(req => view(req.query.brief === '1')));
  app.post('/api/library', h(req => save(req.body || {})));
  app.post('/api/library/run', h(req => require('.').run(person(req))));
  app.post('/api/library/stop', h(() => require('./indexer').stop()));
  app.delete('/api/library/index', h(async () => { await require('./store').clear(); require('../activity').note({ from: 'library', what: 'emptied the index', why: 'asked in the Library section' }); return view(); }));
  app.get('/api/library/search', h(req => {
    const q = String(req.query.q || '').trim();
    if (!q) throw bad('Say what to look for.');
    const list = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null);
    return require('./search').search(person(req), q, { kinds: list(req.query.kinds), folder: req.query.folder || null, tags: list(req.query.tags), limit: Number(req.query.limit) || 20 });
  }));
  app.get('/api/library/similar', h(req => require('./search').similar(person(req), req.query.path, { limit: Number(req.query.limit) || 12 })));
  app.get('/api/library/file', (req, res) => { file(req, res).catch(e => res.status(500).json({ error: e.message })); });
}

module.exports = { mount, view, save };

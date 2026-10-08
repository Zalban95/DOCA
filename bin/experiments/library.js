'use strict';

/**
 * `npm run experiment -- library [--ollama URL] [--model NAME]` (docs/experiments/library.md): a labelled set made on
 * the spot (library-set.js) — spoken clips, drawn pictures, silent videos, documents, all with neutral names — indexed
 * by the real indexer into the throwaway copy of the settings, then one query per file in other words. Reported:
 * recall@5 per kind over the whole set (is the file among the first five, whatever its kind), first with sound
 * embedded alone and then with its words transcribed too, the time to index and per search, and the mechanical tags'
 * precision (the share of kept tags a person would accept, by each file's label). The files are deleted afterwards.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (args, name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

async function index() {
  const I = require('../../modules/library/indexer');
  const t0 = Date.now();
  I.start({ why: 'demand' });
  while (I.running()) await new Promise(r => setTimeout(r, 250));
  return { ms: Date.now() - t0, st: I.view() };
}

async function recall(set, { limit = 5 } = {}) {
  const S = require('../../modules/library/search');
  const by = {}, within = {}, times = [], misses = [];
  let first = 0;
  for (const f of set) {
    const t0 = Date.now();
    const r = await S.search(null, f.query, { limit });
    times.push(Date.now() - t0);
    const rank = r.results.findIndex(x => x.path === f.file);
    (by[f.kind] ||= [0, 0])[1]++;
    if (rank === 0) first++;
    if (rank >= 0) by[f.kind][0]++; else misses.push(`${f.kind}: "${f.query}" → ${r.results.slice(0, 3).map(x => path.basename(x.path)).join(', ')}`);
    const own = await S.search(null, f.query, { limit, kinds: [f.kind] });   // the same query narrowed to its kind, as the kind filter does
    (within[f.kind] ||= [0, 0])[1]++;
    if (own.results.some(x => x.path === f.file)) within[f.kind][0]++;
  }
  return { by, within, first, perSearch: Math.round(times.reduce((a, b) => a + b, 0) / times.length), misses };
}

async function tagPrecision(set) {
  const S = require('../../modules/library/store');
  let kept = 0, right = 0, files = 0, tagged = 0;
  for (const f of set) {
    const it = await S.item(f.file);
    const tags = it?.meta?.tags || [];
    files++; if (tags.length) tagged++;
    kept += tags.length;
    right += tags.filter(t => f.tags.includes(t.tag)).length;
  }
  return { kept, right, files, tagged };
}

async function measure({ args = [] } = {}) {
  const { loadPrefs, savePrefs } = require('../../modules/utils');
  const model = arg(args, 'model', 'embeddinggemma-2:740m-mxfp8');
  const captioner = arg(args, 'captions', null);   // a vision model on the same Ollama: a third run writes captions
  const prefs = loadPrefs();
  const vs = require('../../modules/chat').loadVoiceServices();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-library-set-'));
  try {
    const set = await require('./library-set').make(dir, { ttsUrl: arg(args, 'tts', vs.ttsUrl), ttsModel: vs.ttsModel, ttsVoice: vs.ttsVoice });
    console.log(`Made ${set.length} files in ${dir}.`);
    savePrefs({ ...prefs, models: { ...(prefs.models || {}), ...(arg(args, 'ollama') ? { ollamaUrl: arg(args, 'ollama') } : {}) },
      developer: { ...(prefs.developer || {}), mode: true }, experiments: { ...(prefs.experiments || {}), library: true },
      library: { provider: 'ollama', model, dialect: 'ollama', folders: [dir], kinds: ['documents', 'images', 'audio', 'video'], transcribe: false, captions: false, idleLoad: 64 },
      ...(captioner ? { vision: { ...(prefs.vision || {}), provider: 'ollama', model: captioner } } : {}) });
    const rows = [];
    for (const [transcribe, captions] of [[false, false], [true, false], ...(captioner ? [[true, true]] : [])]) {
      const p = loadPrefs();
      savePrefs({ ...p, library: { ...p.library, transcribe, captions } });
      await require('../../modules/library/store').clear();
      const ix = await index();
      if (ix.st.error) throw new Error(ix.st.error);
      const rc = await recall(set);
      const tg = await tagPrecision(set);
      const pieces = await require('../../modules/library/store').pieceCount();
      if (captions) for (const f of set.filter(x => x.kind === 'images' || x.kind === 'video')) console.log(`  ${path.basename(f.file)} (${f.query}): ${(await require('../../modules/library/store').item(f.file))?.meta?.caption || '—'}`);
      console.log(`\n${captions ? 'With captions' : transcribe ? 'Sound and its words' : 'Sound alone'}: indexed ${ix.st.read} files, ${pieces} pieces in ${ix.ms} ms (${ix.st.failed} failed)`);
      for (const m of rc.misses) console.log(`  missed ${m}`);
      console.log(`  first: ${rc.first}/${set.length}`);
      console.log(`  within its kind: ${Object.entries(rc.within).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', ')}`);
      rows.push({ transcribe, captions, rc, tg, ix, pieces });
    }
    const pct = ([a, b] = [0, 0]) => `${a}/${b}`;
    const [plain, words, capt] = rows;
    if (capt) console.log(`\nWith captions (${captioner}): ${capt.ix.st.captions} written in ${Math.round(capt.ix.ms / 1000)} s; recall@5 images ${pct(capt.rc.by.images)}, video ${pct(capt.rc.by.video)}, audio ${pct(capt.rc.by.audio)}, documents ${pct(capt.rc.by.documents)}`);
    const t = words.tg;
    console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${model} | ${pct(plain.rc.by.audio)} sound alone · ${pct(words.rc.by.audio)} with words | ${pct(words.rc.by.images)} | ${pct(words.rc.by.video)} | ${pct(words.rc.by.documents)} `
      + `| ${Math.round(words.ix.ms / 1000)} s, ${words.pieces} pieces (${set.length} files) | ${words.rc.perSearch} ms | tags ${t.right}/${t.kept} right, ${t.tagged}/${t.files} files tagged |`);
    return 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { measure };

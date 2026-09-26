'use strict';

/**
 * Definitions in and out as markdown (agents/markdown.js), and the two
 * identity files (harness/identity.js).
 *
 *   POST /api/harness/agent-import  { markdown, fileName? } | { folder, overwrite? }
 *        one definition, or every *.md in a folder — e.g. ~/.claude/agents
 *   GET  /api/harness/agents/:id/export   the definition as a .md file
 *   GET/POST /api/harness/identity        { persona, human }
 */
const fs   = require('fs');
const path = require('path');
const registry = require('./registry');
const md = require('./markdown');

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

function importOne(text, fileName, { overwrite = true } = {}) {
  const def = md.parse(text, { fallbackId: String(fileName || '').replace(/\.md$/i, '') });
  const existed = !!registry.get(def.id);
  if (existed && !overwrite) return { id: def.id, skipped: 'an agent with this id exists' };
  const { imported, ...clean } = def;
  const row = registry.save(clean);
  return { id: row.id, label: row.label, kits: row.kits, tools: row.tools, notes: imported, replaced: existed };
}

function mount(app) {
  app.post('/api/harness/agent-import', (req, res) => {
    try {
      const b = req.body || {};
      if (b.markdown) return res.json({ imported: [importOne(b.markdown, b.fileName)] });
      if (!b.folder) throw Object.assign(new Error('Give markdown, or a folder of .md files.'), { status: 400 });
      const { fmSafe } = require('../utils');
      const dir = path.resolve(String(b.folder).replace(/^~(?=$|[/\\])/, require('os').homedir()));
      if (!fmSafe(dir) || !fs.existsSync(dir)) throw Object.assign(new Error(`${dir} is not a folder the panel may read.`), { status: 400 });
      const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
      const imported = [];
      for (const f of files) {
        try { imported.push(importOne(fs.readFileSync(path.join(dir, f), 'utf8'), f, { overwrite: b.overwrite === true })); }
        catch (e) { imported.push({ file: f, error: e.message }); }
      }
      res.json({ imported });
    } catch (e) { fail(res, e); }
  });
  app.get('/api/harness/agents/:id/export', (req, res) => {
    const a = registry.get(req.params.id);
    if (!a || a.broken) return res.status(404).json({ error: 'No such agent.' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${a.id}.md"`);
    res.end(md.format(a));
  });
  const identity = require('../harness/identity');
  app.get('/api/harness/identity', (_req, res) => res.json(identity.get()));
  app.post('/api/harness/identity', (req, res) => {
    try {
      const b = req.body || {};
      if (b.persona !== undefined) identity.write('persona', b.persona);
      if (b.human !== undefined) identity.write('human', b.human);
      res.json(identity.get());
    } catch (e) { fail(res, e); }
  });
}

module.exports = { mount, importOne };

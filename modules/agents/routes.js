'use strict';

/**
 * Definitions in and out as markdown (agents/markdown.js), and the two
 * identity files (harness/identity.js).
 *
 *   POST /api/harness/agent-import  { markdown, fileName? } | { folder, overwrite? }
 *        one definition, or every *.md in a folder — e.g. ~/.claude/agents
 *   GET  /api/harness/agents/:id/export   the definition as a .md file
 *   GET/POST /api/harness/identity        { persona, human }
 *   POST /api/harness/missions            { agentId, task } — an errand for one specialist
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
  // Send an errand to one specialist, chosen by the person rather than by the
  // Orchestrator (TODO.md "You cannot choose which specialist gets the errand").
  // It reports to the Orchestrator like any mission, and runs as whoever sent it.
  app.post('/api/harness/missions', (req, res) => {
    try {
      const row = require('./missions').dispatch({ agentId: String(req.body?.agentId || ''), task: req.body?.task, context: req.body?.context });
      // Marked before its turn reaches withPerson: dispatch starts the turn, which awaits its claim first.
      if (req.auth?.user) require('../harness/memory').updateSession(row.sessionId, { person: { id: req.auth.user.id, orgId: req.auth.orgId } });
      res.json({ mission: row });
    } catch (e) { fail(res, e); }
  });
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
  app.post('/api/harness/agents/:id/promote', (req, res) => {
    try { res.json(registry.promote(req.params.id)); } catch (e) { fail(res, e); }
  });
  app.get('/api/harness/agents/:id/export', (req, res) => {
    const a = registry.get(req.params.id);
    if (!a || a.broken) return res.status(404).json({ error: 'No such agent.' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${a.id}.md"`);
    res.end(md.format(a));
  });
  const skills = require('../harness/skills');
  app.get('/api/harness/skills', (_req, res) => res.json({ skills: skills.list() }));
  // Before /skills/:name, which would take "sources" for a skill's name. Other harnesses' procedures (skill-sources.js).
  const projectOf = q => {
    if (!q) return undefined;
    const dir = path.resolve(String(q).replace(/^~(?=$|[/\\])/, require('os').homedir()));
    if (!require('../utils').fmSafe(dir) || !fs.existsSync(dir)) throw Object.assign(new Error(`${dir} is not a folder the panel may read.`), { status: 400 });
    return dir;
  };
  app.get('/api/harness/skills/sources', (req, res) => {
    try { res.json({ sources: require('../harness/skill-sources').detect({ project: projectOf(req.query.project) }) }); } catch (e) { fail(res, e); }
  });
  app.get('/api/harness/skills/:name', (req, res) => { try { res.json(skills.read(req.params.name)); } catch (e) { fail(res, e); } });
  app.post('/api/harness/skills/import', (req, res) => {
    try {
      if (req.body?.source) {
        return res.json({ imported: require('../harness/skill-sources').importSource(String(req.body.source), {
          names: Array.isArray(req.body.names) ? req.body.names.map(String) : [], overwrite: req.body.overwrite === true,
          project: projectOf(req.body.project) }) });
      }
      const { fmSafe } = require('../utils');
      const dir = path.resolve(String(req.body?.folder || '').replace(/^~(?=$|[/\\])/, require('os').homedir()));
      if (!fmSafe(dir) || !fs.existsSync(dir)) throw Object.assign(new Error(`${dir} is not a folder the panel may read.`), { status: 400 });
      res.json({ imported: skills.importFrom(dir, { overwrite: req.body?.overwrite === true }) });
    } catch (e) { fail(res, e); }
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

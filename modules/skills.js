'use strict';

const fs   = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

const { SKILLS_DIR, WORKSPACE_DIR } = require('./paths');
const { sseHeaders } = require('./utils');

/** Extract description + version from a skill directory's metadata files. */
function readSkillMeta(sp) {
  let description = '', version = '';
  for (const fname of ['package.json', 'skill.json', 'manifest.json']) {
    const fp = path.join(sp, fname);
    if (fs.existsSync(fp)) {
      try { const d = JSON.parse(fs.readFileSync(fp, 'utf8')); description = d.description || ''; version = d.version || ''; }
      catch {}
      break;
    }
  }
  if (!description) {
    for (const fname of ['README.md', 'readme.md']) {
      const fp = path.join(sp, fname);
      if (fs.existsSync(fp)) {
        const lines = fs.readFileSync(fp, 'utf8').split('\n');
        description = lines.find(l => l.trim() && !l.startsWith('#'))?.slice(0, 120) || '';
        break;
      }
    }
  }
  return { description, version };
}

/** GET /api/skills */
function handleList(req, res) {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return res.json({ skills: [] });
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const skills  = entries.filter(e => e.isDirectory()).map(e => {
      const isDisabled = e.name.startsWith('.') && e.name.endsWith('.disabled');
      const realName   = isDisabled ? e.name.slice(1, -9) : e.name;
      const sp = path.join(SKILLS_DIR, e.name);
      const { description, version } = readSkillMeta(sp);
      return { name: realName, dirName: e.name, version, description, enabled: !isDisabled };
    });
    res.json({ skills });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/skills/:name */
function handleDetail(req, res) {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  const actualPath = fs.existsSync(sp) ? sp : fs.existsSync(disabledPath) ? disabledPath : null;
  if (!actualPath) return res.status(404).json({ error: 'Not found' });
  try {
    const files = fs.readdirSync(actualPath).map(f => {
      const s = fs.statSync(path.join(actualPath, f));
      return { name: f, size: s.size, isDir: s.isDirectory() };
    });
    let readme = '';
    const readmeName = files.find(f => f.name.toLowerCase() === 'readme.md');
    if (readmeName) readme = fs.readFileSync(path.join(actualPath, readmeName.name), 'utf8');
    const { description, version } = readSkillMeta(actualPath);
    const enabled = actualPath === sp;
    res.json({ name, enabled, version, description, readme, files, path: actualPath });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/skills/:name/toggle */
function handleToggle(req, res) {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  try {
    if (fs.existsSync(sp)) {
      fs.renameSync(sp, disabledPath);
      res.json({ ok: true, enabled: false });
    } else if (fs.existsSync(disabledPath)) {
      fs.renameSync(disabledPath, sp);
      res.json({ ok: true, enabled: true });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
}

/** POST /api/skills/install */
function handleInstall(req, res) {
  const { skill, force } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill name required' });
  sseHeaders(res);
  const cmd   = `npx clawhub install ${skill}${force ? ' --force' : ''}`;
  const child = spawn('bash', ['-c', cmd], { cwd: WORKSPACE_DIR });
  child.stdout.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.stderr.on('data', d => res.write(`data: ${JSON.stringify(d.toString())}\n\n`));
  child.on('close', code => { res.write(`data: ${JSON.stringify(`[exit ${code}]`)}\n\n`); res.end(); });
  req.on('close', () => child.kill());
}

/** DELETE /api/skills/:name */
function handleDelete(req, res) {
  const name = req.params.name;
  const sp = path.join(SKILLS_DIR, name);
  const disabledPath = path.join(SKILLS_DIR, `.${name}.disabled`);
  const actualPath = fs.existsSync(sp) ? sp : fs.existsSync(disabledPath) ? disabledPath : null;
  if (!actualPath) return res.status(404).json({ error: 'Not found' });
  try { fs.rmSync(actualPath, { recursive: true, force: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

/** GET /api/skills/search — search via clawhub CLI, fallback to GitHub API */
function handleSearch(req, res) {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  const githubFallback = () => {
    const url = `https://api.github.com/search/repositories?q=topic:clawhub-skill+${encodeURIComponent(q)}&sort=stars&per_page=30`;
    const https = require('https');
    https.get(url, { headers: { 'User-Agent': 'openclaw-dashboard/1.0' } }, ghRes => {
      let body = '';
      ghRes.on('data', d => body += d);
      ghRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          const items = data.items || [];
          const results = items.map(r => ({
            name:        r.full_name,
            description: r.description || '',
            version:     '',
            official:    r.owner?.login === 'clawhub',
            community:   r.owner?.login !== 'clawhub',
            source:      'github',
            stars:       r.stargazers_count,
            url:         r.html_url,
          }));
          res.json({ results, via: 'github' });
        } catch (e) {
          res.json({ results: [], error: `GitHub search failed: ${e.message}` });
        }
      });
    }).on('error', e => res.json({ results: [], error: `GitHub search error: ${e.message}` }));
  };

  exec(`npx clawhub search ${JSON.stringify(q)} --json 2>/dev/null`, { timeout: 15000 }, (err, stdout) => {
    if (err || !stdout.trim()) return githubFallback();
    try {
      const parsed = JSON.parse(stdout);
      const results = (Array.isArray(parsed) ? parsed : parsed.results || []).map(s => ({
        name:        s.name        || s.id || '',
        description: s.description || '',
        version:     s.version     || '',
        official:    !!(s.official || s.verified),
        community:   !!(s.community),
        source:      s.source      || s.registry || 'clawhub',
      }));
      res.json({ results, via: 'clawhub' });
    } catch {
      githubFallback();
    }
  });
}

module.exports = {
  handleList,
  handleDetail,
  handleToggle,
  handleInstall,
  handleDelete,
  handleSearch,
};

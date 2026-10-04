/* ═══════════════════════════════════════════════════════
   Settings → Harness → Skills (modules/harness/skills.js): the procedures the
   agent loads when a task matches — shipped with DOCA, made here, or imported
   from a folder of Agent Skills (e.g. ~/.claude/skills) or from other harnesses
   (skill-sources.js: Claude Code commands, Codex prompts, Gemini CLI, Cursor rules).
   ═══════════════════════════════════════════════════════ */

async function skillsCardRender(panel) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'doca-skills-card';
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">Skills
      <button class="btn btn-xs" onclick="docaSkillsImport()" title="Copy skill folders (each with a SKILL.md) from a folder on this machine">⬆ Import</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Procedures the agent loads when a task matches: it always sees each one's name and
      when to use it, and reads the rest only when needed. The agent keeps new ones as it learns them (on this machine).</p>
    <div id="doca-skills-list"><div class="placeholder pulse">Loading…</div></div>
    <div class="card-title" style="margin-top:14px;display:flex;align-items:center;gap:8px">From other harnesses
      <button class="btn btn-xs" onclick="docaSkillsProject()" title="A project's .cursor/rules">Cursor rules…</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Procedures kept by Claude Code (skills, plugin skills, commands), Codex (prompts)
      and Gemini CLI (commands) on this machine. Importing copies them in as skills; the originals are not touched.</p>
    <div id="doca-skills-sources"><div class="placeholder pulse">Looking…</div></div>`;
  panel.appendChild(card);
  docaSkillsLoad();
  docaSkillsSources();
}

/** Other harnesses' procedures found on this machine (modules/harness/skill-sources.js), one row per source. */
async function docaSkillsSources(project) {
  const box = document.getElementById('doca-skills-sources');
  if (!box) return;
  let sources = [];
  try { sources = (await apiFetch(`/api/harness/skills/sources${project ? `?project=${encodeURIComponent(project)}` : ''}`)).sources; }
  catch (e) { box.textContent = e.message; return; }
  box.innerHTML = sources.length ? '' : '<div class="placeholder">None found on this machine.</div>';
  for (const s of sources) {
    const fresh = s.items.filter(i => !i.here);
    const row = document.createElement('div');
    row.className = 'settings-tab-row';
    const b = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: fresh.length ? `Import ${fresh.length}` : 'All imported' });
    b.disabled = !fresh.length;
    b.title = s.items.map(i => `${i.name}${i.here ? ' (already here)' : ''} — ${i.description}`).join('\n');
    b.onclick = async () => {
      try {
        const { imported } = await apiFetch('/api/harness/skills/import', { method: 'POST', body: { source: s.id, project } });
        appAlert(imported.map(r => r.skipped ? `– ${r.name}: ${r.skipped}` : `✓ ${r.name}`).join('\n') || 'Nothing to import.');
        docaSkillsLoad(); docaSkillsSources(project);
      } catch (e) { appAlert(e.message); }
    };
    row.append(b, Object.assign(document.createElement('span'), { className: 'settings-tab-label', textContent: `${s.label} — ${s.items.length} in ${s.path}` }));
    box.appendChild(row);
  }
}

function docaSkillsProject() {
  appPrompt('A project folder whose .cursor/rules to offer:', folder => docaSkillsSources(folder), '');
}

async function docaSkillsLoad() {
  const box = document.getElementById('doca-skills-list');
  let list = [];
  try { list = (await apiFetch('/api/harness/skills')).skills; } catch (e) { box.textContent = e.message; return; }
  box.innerHTML = list.length ? '' : '<div class="placeholder">No skills yet.</div>';
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'settings-tab-row';
    const b = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: s.name });
    b.onclick = async () => { const r = await apiFetch(`/api/harness/skills/${encodeURIComponent(s.name)}`); appAlert(`${r.name} (${r.source})\n\n${r.body.slice(0, 3000)}${r.files.length ? `\n\nFiles: ${r.files.join(', ')}` : ''}`); };
    row.append(b, Object.assign(document.createElement('span'), { className: 'settings-tab-label', textContent: `${s.description}${s.source === 'local' ? ' — made here' : ''}` }));
    box.appendChild(row);
  }
}

function docaSkillsImport() {
  appPrompt('A folder of skills (each a folder with SKILL.md), e.g. ~/.claude/skills:', async folder => {
    try {
      const { imported } = await apiFetch('/api/harness/skills/import', { method: 'POST', body: { folder } });
      appAlert(imported.length ? imported.map(r => r.skipped ? `– ${r.name}: ${r.skipped}` : `✓ ${r.name}`).join('\n') : 'No skill folders there.');
      docaSkillsLoad();
    } catch (e) { appAlert(e.message); }
  }, '~/.claude/skills');
}

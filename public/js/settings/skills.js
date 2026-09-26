/* ═══════════════════════════════════════════════════════
   Settings → Harness → Skills (modules/harness/skills.js): the procedures the
   agent loads when a task matches — shipped with DOCA, made here, or imported
   from a folder of Agent Skills (e.g. ~/.claude/skills).
   ═══════════════════════════════════════════════════════ */

async function skillsCardRender(panel) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'doca-skills-card';
  card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:8px">Skills
      <button class="btn btn-xs" onclick="docaSkillsImport()" title="Copy skill folders (each with a SKILL.md) from a folder on this machine">⬆ Import</button></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:10px">Procedures the agent loads when a task matches: it always sees each one's name and
      when to use it, and reads the rest only when needed. The agent keeps new ones as it learns them (on this machine).</p>
    <div id="doca-skills-list"><div class="placeholder pulse">Loading…</div></div>`;
  panel.appendChild(card);
  docaSkillsLoad();
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

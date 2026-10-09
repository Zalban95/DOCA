/* ═══════════════════════════════════════════════════════
   Settings → Harness → Skills → From public collections
   (modules/harness/skill-online.js): search open Agent Skills collections on
   GitHub, look at one before taking it — its SKILL.md as written, what the
   audit finds in it, every file it carries and which are scripts — and import
   it with a click. Nothing it carries is run.
   ═══════════════════════════════════════════════════════ */

function skillsOnlineRender(box) {
  if (!box) return;
  box.innerHTML = `<div class="card-title" style="margin-top:14px">From public collections</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Open collections of skills on GitHub — Anthropic's, OpenAI's, Superpowers and Hugging Face's.
      Look at one before importing it: you see its instructions, what it carries and which files are scripts. Importing copies it here; nothing in it is run.</p>
    <div style="display:flex;gap:6px"><input class="input" id="doca-skills-online-q" placeholder="Search them (empty: list all)" style="flex:1">
      <button class="btn btn-xs" id="doca-skills-online-go">Search</button></div>
    <div id="doca-skills-online-hits"></div>`;
  const go = () => skillsOnlineSearch(document.getElementById('doca-skills-online-q').value.trim());
  document.getElementById('doca-skills-online-go').onclick = go;
  document.getElementById('doca-skills-online-q').onkeydown = e => { if (e.key === 'Enter') go(); };
}

async function skillsOnlineSearch(q) {
  const box = document.getElementById('doca-skills-online-hits');
  box.innerHTML = '<div class="placeholder pulse">Reading the collections…</div>';
  let r;
  try { r = await apiFetch(`/api/harness/skills/online?q=${encodeURIComponent(q)}`); } catch (e) { box.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  box.innerHTML = (r.failed || []).map(f => `<div class="muted" style="font-size:11px">Not read: ${escHtml(f)}</div>`).join('')
    + (r.results.length ? '' : '<div class="placeholder">No skill there mentions that.</div>');
  for (const k of r.results) {
    const row = document.createElement('div');
    row.className = 'settings-tab-row';
    const look = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: k.here ? `${k.name} (here)` : `Look: ${k.name}` });
    look.onclick = () => skillsOnlinePlan(k, row);
    const label = Object.assign(document.createElement('span'), { className: 'settings-tab-label' });
    label.append(Object.assign(document.createElement('strong'), { textContent: k.source }), ` — ${k.description}`);
    row.append(look, label);
    box.appendChild(row);
  }
}

/** The dry run, under the result: nothing is written until Import. */
async function skillsOnlinePlan(k, row) {
  row.nextElementSibling?.classList.contains('skill-plan') && row.nextElementSibling.remove();
  const el = document.createElement('div');
  el.className = 'skill-plan';
  el.innerHTML = '<div class="placeholder pulse">Reading it…</div>';
  row.after(el);
  let p;
  try { p = await apiFetch(`/api/harness/skills/online/plan?repo=${encodeURIComponent(k.repo)}&dir=${encodeURIComponent(k.dir)}`); }
  catch (e) { el.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
  const audit = p.audit.status === 'adapt'
    ? `Written for ${escHtml(p.audit.label || 'another harness')}: ${p.audit.findings.length} place${p.audit.findings.length === 1 ? '' : 's'} to translate (the agent translates while reading; adapt it after importing to make that permanent).`
    : 'Written in terms any agent reads: nothing to translate.';
  el.innerHTML = `<div class="muted" style="margin:4px 0">From <a href="${escHtml(p.url)}" target="_blank" rel="noopener">${escHtml(p.url)}</a> · ${p.files.length} file${p.files.length === 1 ? '' : 's'}, ${Math.round(p.bytes / 1024)} KB</div>
    <div style="font-size:11px">${audit}</div>
    ${p.scripts.length ? `<div style="font-size:11px;color:var(--amber)">Scripts it carries (copied, never run on import; the agent may run them later under your approvals): ${escHtml(p.scripts.join(', '))}</div>` : '<div style="font-size:11px">No scripts.</div>'}
    <div class="muted" style="font-size:11px">Files: ${escHtml(p.files.map(f => f.path).join(', '))}</div>
    <pre>${escHtml(p.text.slice(0, 12000))}</pre>
    ${p.tooBig ? `<div style="color:var(--red);font-size:11px">Too big to import here: ${escHtml(p.tooBig)}.</div>` : !p.validName ? `<div style="color:var(--red);font-size:11px">"${escHtml(p.name)}" is not a skill name here.</div>`
      : `<div style="display:flex;gap:6px;margin:6px 0"><button class="btn btn-xs btn-teal" data-imp>${p.exists ? 'Import, replacing the one here' : 'Import'}</button><button class="btn btn-xs" data-close>Close</button></div>`}`;
  el.querySelector('[data-close]')?.addEventListener('click', () => el.remove());
  el.querySelector('[data-imp]')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const r = await apiFetch('/api/harness/skills/online/import', { method: 'POST', body: { repo: k.repo, dir: k.dir, overwrite: p.exists } });
      appAlert(r.imported.map(x => x.skipped ? `– ${x.name}: ${x.skipped}` : `✓ ${x.name} imported — used when it fits; attach it to modes above if you want it always.`).join('\n'));
      el.remove(); docaSkillsLoad();
    } catch (err) { appAlert(err.message); e.target.disabled = false; }
  });
}

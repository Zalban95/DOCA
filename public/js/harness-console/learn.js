/* ═══════════════════════════════════════════════════════
   The learning loop (modules/harness/learn.js; TODO H10.3): a skill drafted
   from the open conversation — when to use it, the steps that worked, the
   pitfalls — shown to you to read and edit, and saved only by Save.
   ═══════════════════════════════════════════════════════ */

let _hcLearn = null;

async function hcSkillDraft() {
  if (!_hcSession) return appAlert('Open a conversation first.');
  hcSkillClose();
  const ov = document.createElement('div');
  ov.className = 'hc-roster';
  ov.innerHTML = `<div class="hc-roster-box"><div class="hc-roster-head"><b>A skill from this conversation</b><span style="flex:1"></span>
      <button class="btn btn-xs" onclick="hcSkillClose()">✕</button></div>
    <div class="hc-roster-note" id="hc-learn-note">Drafting from the conversation…</div>
    <div class="hc-roster-list" id="hc-learn-body"></div></div>`;
  document.body.appendChild(ov);
  _hcLearn = { ov, release: overlayBack(() => hcSkillClose(true)) };
  let d;
  try { d = await apiFetch('/api/harness/skills/draft', { method: 'POST', body: { sessionId: _hcSession } }); }
  catch (e) { document.getElementById('hc-learn-note').textContent = `✗ ${e.message}`; return; }
  document.getElementById('hc-learn-note').textContent = 'A draft — read it, change what is wrong, then save. Nothing is written until you do; the agents load it when a task matches its description.';
  document.getElementById('hc-learn-body').innerHTML = `
    <div class="input-label">Name</div><input class="input" id="hc-learn-name" value="${escHtml(d.name)}">
    <div class="input-label" style="margin-top:8px">When to use it</div><input class="input" id="hc-learn-desc" value="${escHtml(d.description)}">
    <div class="input-label" style="margin-top:8px">Instructions</div><textarea class="input" id="hc-learn-text" rows="16" style="font-family:var(--font-mono);font-size:12px">${escHtml(d.body)}</textarea>
    <div class="toolbar" style="margin-top:10px;gap:8px"><button class="btn btn-sm btn-blue" onclick="hcSkillSave()">Save the skill</button><span class="status-line" id="hc-learn-status"></span></div>`;
}

async function hcSkillSave(overwrite = false) {
  const v = id => document.getElementById(id).value.trim();
  try {
    const s = await apiFetch('/api/harness/skills', { method: 'POST', body: { name: v('hc-learn-name'), description: v('hc-learn-desc'), body: document.getElementById('hc-learn-text').value, overwrite } });
    hcSkillClose();
    appAlert(`Saved the skill "${s.name}". It is in Settings → Harness → Skills, and in every agent's manifest.`);
  } catch (e) {
    if (/exists here/.test(e.message)) return appConfirm(`${e.message}\n\nReplace it?`, () => hcSkillSave(true));
    setStatus(document.getElementById('hc-learn-status'), `✗ ${e.message}`, 'err');
  }
}

function hcSkillClose(fromBack) {
  if (!_hcLearn) return;
  const { ov, release } = _hcLearn;
  _hcLearn = null;
  ov.remove();
  if (!fromBack) release();
}

/* ═══════════════════════════════════════════════════════
   Settings → Harness → Skills: how each skill is used (modules/harness/skill-use.js).
   - When it fits (the default): the agent sees its name and when to use it,
     and reads it on a matching request — every skill not switched off stays
     reachable that way.
   - Attached: it goes with every turn in the modes ticked, optionally only in
     project chats. This is where the hive's default per mode is set; a
     project (Projects → Build & test) and a chat (✦ in its bar) may change it.
   - Off: the agent does not see it.
   Under each row's Advanced: its trigger words (skill-triggers.js), one per
   line, any language, and ✨ Suggest (one model call; the person saves).
   Saved to prefs `skillUse` through POST /api/prefs, field by field.
   ═══════════════════════════════════════════════════════ */

const SKILL_MODES = [['agent', 'Agent'], ['plan', 'Plan'], ['ask', 'Ask'], ['debug', 'Debug']];
const SKILL_USES = [['fits', 'When it fits'], ['attached', 'Attached'], ['off', 'Off']];

async function _skillUseSave(name, value) {
  try { await apiFetch('/api/prefs', { method: 'POST', body: { skillUse: { [name]: value } } }); }
  catch (e) { appAlert(e.message); }
  docaSkillsLoad();
}

/** The filter and the auto-accept switch, above the list. */
async function skillUseHead(box) {
  let auto = false;
  try { auto = !!(await apiFetch('/api/prefs'))?.skillSuggest?.autoAccept; } catch { /* drawn off */ }
  const brand = typeof convBrand === 'function' ? convBrand() : 'The hub';
  box.innerHTML = `<div class="skill-use-row">
      <label>Show <select class="input" id="doca-skills-filter">
        <option value="">All</option><option value="attached">Attached</option><option value="fits">When it fits</option><option value="off">Off</option></select></label>
      <label class="switch-label" title="When a message names a skill by one of its trigger words. A project chat in Agent mode attaches them anyway; a chat's ⋯ may say otherwise.">
        <input type="checkbox" id="doca-skills-auto" ${auto ? 'checked' : ''}> Attach skills ${escHtml(brand)} suggests without asking</label></div>`;
  box.querySelector('#doca-skills-filter').onchange = () => docaSkillsLoad();
  box.querySelector('#doca-skills-auto').onchange = async e => {
    try { await apiFetch('/api/prefs', { method: 'POST', body: { skillSuggest: { autoAccept: e.target.checked } } }); } catch (err) { appAlert(err.message); }
  };
}

/** Whether a skill passes the filter chosen above the list. */
function skillUseShown(s) {
  const f = document.getElementById('doca-skills-filter')?.value || '';
  return !f || s.use === f;
}

/** The controls under one skill's row. */
function skillUseControls(s) {
  const el = document.createElement('div');
  el.className = 'skill-use-row';
  const def = s.byDefault || s;
  const modes = SKILL_MODES.map(([k, l]) => `<label><input type="checkbox" data-mode="${k}" ${s.modes?.includes(k) ? 'checked' : ''}> ${l}</label>`).join('');
  const trig = s.triggerSet || { triggers: [], made: true };
  el.innerHTML = `<select class="input" data-use title="How the agent uses this skill">
      ${SKILL_USES.map(([k, l]) => `<option value="${k}" ${s.use === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span class="skill-use-modes" ${s.use === 'attached' ? '' : 'hidden'}>in ${modes}
      <label title="Only in conversations working in a project or a worktree"><input type="checkbox" data-where ${s.where === 'project' ? 'checked' : ''}> only in project chats</label></span>
    ${s.from === 'setting' ? `<button class="btn btn-xs" data-reset title="Back to the skill's own: ${escHtml(def.use === 'attached' ? `attached in ${def.modes.join(', ')}${def.where === 'project' ? ', project chats' : ''}` : 'when it fits')}">Reset</button>` : '<span class="muted">its own default</span>'}
    <div class="skill-use-adv">${advancedFold(`<label class="muted">Triggers — words or short phrases, one per line, in any language${trig.made ? ' (none written: these are made from its name and description)' : ''}</label>
      <textarea class="input" data-trig rows="3" style="width:100%" data-default="${escHtml((s.byDefault?.triggers?.length ? s.byDefault.triggers : trig.made ? trig.triggers : s.triggers).join('\n'))}">${escHtml(trig.triggers.join('\n'))}</textarea>
      <div style="display:flex;gap:6px;margin-top:4px"><button class="btn btn-xs" data-trig-save>Save triggers</button>
        <button class="btn btn-xs" data-trig-ai title="Ask the model once for more, in English and Italian; nothing is kept until you save">✨ Suggest</button></div>`,
      { id: `skill-trig-${s.name}`, label: 'Advanced' })}</div>`;
  const q = sel => el.querySelector(sel);
  const save = () => _skillUseSave(s.name, { use: q('[data-use]').value,
    modes: [...el.querySelectorAll('[data-mode]:checked')].map(x => x.dataset.mode), where: q('[data-where]').checked ? 'project' : 'any' });
  q('[data-use]').onchange = () => {
    q('.skill-use-modes').hidden = q('[data-use]').value !== 'attached';
    if (q('[data-use]').value === 'attached' && !el.querySelector('[data-mode]:checked')) q('[data-mode="agent"]').checked = true;
    save();
  };
  el.querySelectorAll('[data-mode], [data-where]').forEach(x => { x.onchange = save; });
  if (q('[data-reset]')) q('[data-reset]').onclick = () => _skillUseSave(s.name, null);
  q('[data-trig-save]').onclick = () => _skillUseSave(s.name, { triggers: q('[data-trig]').value.split('\n').map(x => x.trim()).filter(Boolean) });
  q('[data-trig-ai]').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Asking…';
    try {
      const { triggers } = await apiFetch(`/api/harness/skills/${encodeURIComponent(s.name)}/triggers/suggest`, { method: 'POST', body: { languages: 'English, Italian' } });
      const box = q('[data-trig]');
      box.value = [...new Set([...box.value.split('\n').map(x => x.trim()).filter(Boolean), ...triggers])].join('\n');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) { appAlert(err.message); }
    e.target.disabled = false; e.target.textContent = '✨ Suggest';
  };
  return el;
}

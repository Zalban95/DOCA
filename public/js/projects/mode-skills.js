/* ═══════════════════════════════════════════════════════
   Projects → Build & test → Skills by mode (modules/harness/skill-use.js):
   which skills go with every turn of this project's conversations, per mode.
   Each mode follows Settings → Harness → Skills unless the project names its
   own list; a chat may still add or remove one (✦ in its bar).
   ═══════════════════════════════════════════════════════ */

const PJ_MODES = [['agent', 'Agent'], ['plan', 'Plan'], ['ask', 'Ask'], ['debug', 'Debug']];

async function pjModeSkillsSection(body) {
  const box = document.createElement('div');
  box.className = 'pj-env';
  body.appendChild(box);
  let skills = [];
  try { skills = (await apiFetch('/api/harness/skills')).skills || []; } catch { /* names typed by hand */ }
  if (!box.isConnected) return;
  const own = PJ.project?.project?.modeSkills || {};
  const hive = m => skills.filter(s => s.use === 'attached' && s.modes.includes(m)).map(s => s.name);   // project chats get where:project ones too
  const rows = PJ_MODES.map(([m, l]) => `<div style="margin:4px 0"><label class="pj-meta">${l}</label>
    <select class="input pj-ms-mode" data-m="${m}" style="width:100%"><option value="">As Settings: ${escHtml(hive(m).join(', ') || 'none')}</option>
      <option value="own" ${Array.isArray(own[m]) ? 'selected' : ''}>This project's own</option></select>
    <input class="input pj-ms-list" data-m="${m}" placeholder="skill names, comma-separated (empty: none)" style="width:100%;margin-top:3px"
      value="${escHtml((own[m] || []).join(', '))}" ${Array.isArray(own[m]) ? '' : 'hidden'} list="pj-ms-names"></div>`).join('');
  const changed = PJ_MODES.filter(([m]) => Array.isArray(own[m])).length;
  box.innerHTML = advancedFold(`${rows}<datalist id="pj-ms-names">${skills.map(s => `<option value="${escHtml(s.name)}">`).join('')}</datalist>
    <button class="btn btn-xs" id="pj-ms-save" style="margin-top:4px">Save</button>`, { id: 'pj-mode-skills', label: 'Skills by mode', changed });
  box.querySelectorAll('.pj-ms-mode').forEach(sel => { sel.onchange = () => { box.querySelector(`.pj-ms-list[data-m="${sel.dataset.m}"]`).hidden = sel.value !== 'own'; }; });
  box.querySelector('#pj-ms-save').onclick = async () => {
    const modeSkills = {};
    for (const [m] of PJ_MODES) {
      if (box.querySelector(`.pj-ms-mode[data-m="${m}"]`).value !== 'own') continue;
      modeSkills[m] = box.querySelector(`.pj-ms-list[data-m="${m}"]`).value.split(',').map(x => x.trim()).filter(Boolean);
    }
    try {
      const r = await apiFetch(_pjp(''), { method: 'POST', body: { modeSkills: Object.keys(modeSkills).length ? modeSkills : null } });
      PJ.project.project = r.project;
      appAlert('Saved: the project\'s conversations take these from their next turn.');
    } catch (e) { appAlert(e.message); }
  };
}

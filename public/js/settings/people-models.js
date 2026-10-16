/* ═══════════════════════════════════════════════════════
   Settings → Users → Models for people (modules/people-models; the owner's decision of 2026-10-16): whether people
   run on the owner's models, choose their own, or run on one the owner assigns — any combination. Only what applies
   is drawn: the assignments only while assigning is on, the per-level and per-person rows folded under Advanced.
   Saved through POST /api/prefs (replacing `peopleModels` whole), which asks for the password (auth/guarded.js).
   ═══════════════════════════════════════════════════════ */

const _PM_PATHS = ['same', 'choose', 'assign', 'all', 'levels', 'people'].map(k => `peopleModels.${k}`);

async function _usersModelsCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'users-models' });
  let pol = {};
  try {
    const r = await apiFetch(`/api/settings/leaves?paths=${encodeURIComponent(_PM_PATHS.join(','))}`);
    for (const l of r.leaves || []) pol[l.path.split('.')[1]] = l.value;
  } catch { return null; }   // the machine's settings are a host's: someone without host sees no card
  _pmDraw(card, pol);
  return card;
}

function _pmDraw(card, pol) {
  const levels = (_usersData.levels || []).filter(l => l.id !== 'owner');
  const people = (_usersData.users || []).filter(u => u.level !== 'owner');
  const sw = (key, label, hint) => `<label class="pm-row" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0">
    <input type="checkbox" data-pm="${key}" ${pol[key] ? 'checked' : ''}><span><b>${escHtml(label)}</b><br><span class="desc">${escHtml(hint)}</span></span></label>`;
  const field = (attr, id, label, value) => `<div class="form-row" style="margin:4px 0"><label class="input-label" for="${id}">${escHtml(label)}</label>
    <input class="input" id="${id}" ${attr} data-default="" value="${escHtml(value || '')}" placeholder="provider/model" style="width:min(320px,100%)"></div>`;
  const perLevel = levels.map(l => field(`data-pm-level="${escHtml(l.id)}"`, `pm-level-${escHtml(l.id)}`, `Level: ${l.name}`, pol.levels?.[l.id])).join('');
  const perPerson = people.map(u => field(`data-pm-person="${escHtml(u.id)}"`, `pm-person-${escHtml(u.id)}`, u.name || u.email, pol.people?.[u.id])).join('');
  const changed = Object.values(pol.levels || {}).filter(Boolean).length + Object.values(pol.people || {}).filter(Boolean).length;
  card.innerHTML = `<div class="card-title">Models for people</div>
    <p class="desc" style="margin-bottom:6px">Which models the people here run on — any combination. A model is still only
      used when it is allotted to the person (a level's models), and their budget still counts.</p>
    ${sw('same', 'Same models as you', 'Everyone runs on your models (the agent\'s model and its fallbacks) unless something below says otherwise. Off: someone with nothing assigned and no choice of their own has no model.')}
    ${sw('choose', 'They choose their own', 'People pick a model for a conversation in the chat\'s model picker. Admins always may.')}
    ${sw('assign', 'You assign them', 'One model for everyone but you, for a level, or for one person — the most specific wins.')}
    <div data-pm-assign ${pol.assign ? '' : 'hidden'}>
      ${field('data-pm-all', 'pm-all', 'Everyone but you', pol.all)}
      ${levels.length || people.length ? advancedFold(perLevel + perPerson, { label: 'Per level and per person', id: 'people-models-each', changed }) : ''}
    </div>
    <div style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-pm-save>Save</button> <span class="desc" data-pm-said></span></div>`;
  card.querySelector('[data-pm="assign"]').onchange = e => { card.querySelector('[data-pm-assign]').hidden = !e.target.checked; };
  card.querySelector('[data-pm-save]').onclick = () => _pmSave(card);
}

async function _pmSave(card) {
  const val = sel => card.querySelector(sel)?.value.trim() || '';
  const map = attr => Object.fromEntries([...card.querySelectorAll(`[${attr}]`)].map(el => [el.getAttribute(attr), el.value.trim()]).filter(([, v]) => v));
  const bad = [...card.querySelectorAll('[data-pm-all],[data-pm-level],[data-pm-person]')].find(el => el.value.trim() && !/^[^/\s]+\/\S+$/.test(el.value.trim()));
  if (bad) { appAlert(`"${bad.value}" is not provider/model.`); bad.focus(); return; }
  const body = { peopleModels: { same: card.querySelector('[data-pm="same"]').checked, choose: card.querySelector('[data-pm="choose"]').checked,
    assign: card.querySelector('[data-pm="assign"]').checked, all: val('[data-pm-all]'), levels: map('data-pm-level'), people: map('data-pm-person') } };
  const said = card.querySelector('[data-pm-said]');
  try { await apiFetch('/api/prefs?replace=1', { method: 'POST', body }); said.textContent = 'Saved.'; }
  catch (e) { said.textContent = ''; appAlert(e.message); }
}

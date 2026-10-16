/* ═══════════════════════════════════════════════════════
   Settings → Users → Models for people (modules/people-models; the owner's decisions of 2026-10-16): whether people
   run on the owner's models, choose their own, or run on one assigned to them. The owner sets the switches and "everyone
   but you" (POST /api/prefs, replacing `peopleModels` whole); the owner and every admin (users, or a team leader for
   models) assign per person and per level — only the people and levels below them are drawn — through
   POST /api/people-models/assign, which records who set it. Both ask for the password (auth/guarded.js).
   ═══════════════════════════════════════════════════════ */

async function _usersModelsCard() {
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'users-models' });
  let v;
  try { v = await apiFetch('/api/people-models'); } catch { return null; }   // not an admin: no card
  _pmDraw(card, v);
  return card;
}

const _pmWho = r => (r ? `${r.model === 'none' ? 'nothing assigned' : escHtml(r.model)} <span class="desc">— set by ${escHtml(r.byName || 'an admin')}</span>` : '');

/** One row: a person or a level, and one picker — Not set, Nothing assigned, the models allotted to them, Other model…. */
function _pmRow(kind, t) {
  const id = `pm-${kind}-${escHtml(t.id)}`, mine = t.mine?.model || '';
  const opts = [...new Set([...(t.options || []), ...(mine && mine !== 'none' ? [mine] : [])])];
  const c = t.counts;
  const counts = c ? `<span class="desc">${c.none ? 'Nothing assigned' : `Runs on ${escHtml(c.model)}`} — ${escHtml(c.setBy === 'owner' ? 'the owner\'s' : 'an admin\'s')} rule for ${escHtml(c.from === 'person' ? 'them' : c.from === 'level' ? 'their level' : 'everyone')}, by ${escHtml(c.byName || '—')}</span>` : '';
  const notes = [t.owner && !t._me ? `Owner's: ${_pmWho(t.owner)}` : '', t.admin && t._me ? `An admin's: ${_pmWho(t.admin)}` : '', t.admin && !t._me && t.admin.byName ? `Set by ${escHtml(t.admin.byName)}` : ''].filter(Boolean).join(' · ');
  return `<div class="form-row pm-target" style="margin:6px 0;align-items:flex-start;gap:8px;flex-wrap:wrap">
    <label class="input-label" for="${id}" style="min-width:160px">${escHtml(t.name)}${t.levelName ? ` <small class="desc">${escHtml(t.levelName)}</small>` : ''}</label>
    <div style="flex:1;min-width:220px"><select class="input" id="${id}" data-pm-${kind}="${escHtml(t.id)}" data-was="${escHtml(mine)}" data-default="" style="width:min(320px,100%)">
        <option value="" ${!mine ? 'selected' : ''}>Not set</option>
        <option value="none" ${mine === 'none' ? 'selected' : ''}>Nothing assigned</option>
        ${opts.map(m => `<option value="${escHtml(m)}" ${m === mine ? 'selected' : ''}>${escHtml(m)}</option>`).join('')}
        <option value="__other">Other model…</option></select>
      ${notes ? `<div class="desc" style="margin-top:2px">${notes}</div>` : ''}${counts ? `<div>${counts}</div>` : ''}</div></div>`;
}

function _pmDraw(card, v) {
  const owner = v.me?.owner, pol = v.policy || {};
  // What this person changes for each target: the owner's slot for the owner, an admin's own slot for an admin.
  const mark = t => ({ ...t, _me: owner, mine: owner ? t.owner : t.admin });
  const people = (v.people || []).map(mark), levels = (v.levels || []).map(mark);
  const sw = (key, label, hint) => `<label class="pm-row" style="display:flex;gap:8px;align-items:flex-start;margin:6px 0">
    <input type="checkbox" data-pm="${key}" ${pol[key] ? 'checked' : ''}><span><b>${escHtml(label)}</b><br><span class="desc">${escHtml(hint)}</span></span></label>`;
  const rows = levels.map(l => _pmRow('level', { ...l, name: `Level: ${l.name}` })).join('') + people.map(p => _pmRow('person', p)).join('');
  const changed = people.filter(p => p.mine).length + levels.filter(l => l.mine).length;
  card.innerHTML = `<div class="card-title">Models for people</div>
    <p class="desc" style="margin-bottom:6px">${owner ? 'Which models the people here run on — any combination. ' : 'The models the people below your level run on. You choose your own in the chat\'s model picker. '}A model is
      still only used when it is allotted to the person (a level's models), and their budget still counts.</p>
    ${owner ? `${sw('same', 'Same models as you', 'Everyone runs on your models (the agent\'s model and its fallbacks) unless something below says otherwise. Off: someone with nothing assigned and no choice of their own has no model.')}
    ${sw('choose', 'They choose their own', 'People pick a model for a conversation in the chat\'s model picker. Admins always may.')}
    ${sw('assign', 'You assign them', 'Your assignments count while this is on. Admins assign to the people below them too; where you both set a rule for the same person or level, yours wins.')}
    <div data-pm-assign ${pol.assign ? '' : 'hidden'}>
      <div class="form-row" style="margin:4px 0"><label class="input-label" for="pm-all">Everyone but you</label>
        <input class="input" id="pm-all" data-pm-all data-default="" value="${escHtml(pol.all || '')}" placeholder="provider/model" style="width:min(320px,100%)"></div>
    </div>` : ''}
    ${rows ? (owner ? advancedFold(rows, { label: 'Per level and per person', id: 'people-models-each', changed }) : rows)
      : `<p class="desc">${owner ? 'Nobody else here yet.' : 'Nobody here is below your level.'}</p>`}
    <p class="desc" style="margin-top:6px">${escHtml(v.rule || '')}</p>
    <div style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-pm-save>Save</button> <span class="desc" data-pm-said role="status"></span></div>`;
  if (owner) card.querySelector('[data-pm="assign"]').onchange = e => { card.querySelector('[data-pm-assign]').hidden = !e.target.checked; };
  card.querySelectorAll('select[data-pm-person],select[data-pm-level]').forEach(sel => { sel.onchange = () => _pmOther(sel); });
  card.querySelector('[data-pm-save]').onclick = () => _pmSave(card, pol, owner);
}

/** "Other model…": a model named nowhere yet, typed once and added to that picker. */
function _pmOther(sel) {
  if (sel.value !== '__other') return;
  const back = () => { sel.value = sel.dataset.was || ''; };
  appPrompt('Which model? provider/model', v => {
    const m = String(v || '').trim();
    if (!/^[^/\s]+\/\S+$/.test(m)) { back(); if (m) appAlert(`"${m}" is not provider/model.`); return; }
    sel.insertBefore(Object.assign(document.createElement('option'), { value: m, textContent: m }), sel.querySelector('option[value="__other"]'));
    sel.value = m;
  }, '', { onCancel: back });
}

/** One Save: the owner's switches (prefs) and every changed row (one request, all or nothing) — the password asked once. */
async function _pmSave(card, pol, owner) {
  const said = card.querySelector('[data-pm-said]');
  const changes = [...card.querySelectorAll('select[data-pm-person],select[data-pm-level]')].filter(s => s.value !== '__other' && s.value !== (s.dataset.was || ''))
    .map(s => ({ [s.dataset.pmPerson ? 'personId' : 'levelId']: s.dataset.pmPerson || s.dataset.pmLevel, model: s.value }));
  try {
    if (owner) {
      const all = card.querySelector('[data-pm-all]')?.value.trim() || '';
      if (all && !/^[^/\s]+\/\S+$/.test(all)) { appAlert(`"${all}" is not provider/model.`); return; }
      const next = { same: card.querySelector('[data-pm="same"]').checked, choose: card.querySelector('[data-pm="choose"]').checked, assign: card.querySelector('[data-pm="assign"]').checked, all };
      if (Object.entries(next).some(([k, val]) => (pol[k] ?? (k === 'all' ? '' : k === 'same')) !== val))
        await apiFetch('/api/prefs?replace=1', { method: 'POST', body: { peopleModels: { ...next, levels: pol.levels || {}, people: pol.people || {} } } });
    }
    if (changes.length) await apiFetch('/api/people-models/assign', { method: 'POST', body: { changes } });
    _pmDraw(card, await apiFetch('/api/people-models'));
    card.querySelector('[data-pm-said]').textContent = 'Saved.';
  } catch (e) { if (said) said.textContent = ''; appAlert(e.message); }
}

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

const _pmWho = r => (r ? `${escHtml(r.model)} <span class="desc">— set by ${escHtml(r.byName || 'an admin')}</span>` : '');

function _pmRow(kind, t) {
  const id = `pm-${kind}-${escHtml(t.id)}`;
  const mine = t.mine?.model || '';
  const counts = t.counts ? `<span class="desc">Runs on ${escHtml(t.counts.model)} (${escHtml(t.counts.setBy === 'owner' ? 'the owner\'s' : 'an admin\'s')} for ${escHtml(t.counts.from === 'person' ? 'them' : t.counts.from === 'level' ? 'their level' : 'everyone')}, by ${escHtml(t.counts.byName || '—')})</span>` : '';
  const notes = [t.owner && !t._me ? `Owner's: ${_pmWho(t.owner)}` : '', t.admin ? `Admin's: ${_pmWho(t.admin)}` : ''].filter(Boolean).join('<br>');
  return `<div class="form-row pm-target" style="margin:6px 0;align-items:flex-start;gap:8px;flex-wrap:wrap">
    <label class="input-label" for="${id}" style="min-width:160px">${escHtml(t.name)}${t.levelName ? ` <small class="desc">${escHtml(t.levelName)}</small>` : ''}</label>
    <div style="flex:1;min-width:220px"><input class="input" id="${id}" data-pm-${kind}="${escHtml(t.id)}" data-default="" value="${escHtml(mine)}" placeholder="provider/model (empty: none)" style="width:min(320px,100%)">
      <button type="button" class="btn btn-sm" data-pm-set="${kind}:${escHtml(t.id)}">Assign</button>
      ${notes ? `<div class="desc" style="margin-top:2px">${notes}</div>` : ''}${counts ? `<div>${counts}</div>` : ''}</div></div>`;
}

function _pmDraw(card, v) {
  const owner = v.me?.owner, pol = v.policy || {};
  // What this person may change for each target: the owner's slot for the owner, an admin's own slot for an admin.
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
    ${sw('assign', 'You assign them', 'One model for everyone but you, for a level, or for one person — the most specific wins. Admins assign to the people below them too; where you both do, yours wins.')}
    <div data-pm-assign ${pol.assign ? '' : 'hidden'}>
      <div class="form-row" style="margin:4px 0"><label class="input-label" for="pm-all">Everyone but you</label>
        <input class="input" id="pm-all" data-pm-all data-default="" value="${escHtml(pol.all || '')}" placeholder="provider/model" style="width:min(320px,100%)"></div>
    </div>
    <div style="margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-pm-save>Save</button> <span class="desc" data-pm-said></span></div>` : ''}
    ${rows ? (owner ? advancedFold(rows, { label: 'Per level and per person', id: 'people-models-each', changed }) : rows)
      : `<p class="desc">${owner ? 'Nobody else here yet.' : 'Nobody here is below your level.'}</p>`}
    <p class="desc" style="margin-top:6px">${escHtml(v.rule || '')}</p>
    <span class="desc" data-pm-row-said role="status"></span>`;
  if (owner) {
    card.querySelector('[data-pm="assign"]').onchange = e => { card.querySelector('[data-pm-assign]').hidden = !e.target.checked; };
    card.querySelector('[data-pm-save]').onclick = () => _pmSave(card, pol);
  }
  card.querySelectorAll('[data-pm-set]').forEach(b => { b.onclick = () => _pmAssign(card, b); });
}

async function _pmAssign(card, b) {
  const [kind, id] = b.dataset.pmSet.split(/:(.*)/s);
  const input = card.querySelector(`[data-pm-${kind}="${CSS.escape(id)}"]`), model = input.value.trim();
  const said = card.querySelector('[data-pm-row-said]');
  if (model && !/^[^/\s]+\/\S+$/.test(model)) { appAlert(`"${model}" is not provider/model.`); input.focus(); return; }
  try {
    await apiFetch('/api/people-models/assign', { method: 'POST', body: { [kind === 'level' ? 'levelId' : 'personId']: id, model } });
    _pmDraw(card, await apiFetch('/api/people-models'));
    card.querySelector('[data-pm-row-said]').textContent = model ? 'Assigned.' : 'Cleared.';
  } catch (e) { if (said) said.textContent = ''; appAlert(e.message); }
}

async function _pmSave(card, pol) {
  const all = card.querySelector('[data-pm-all]')?.value.trim() || '';
  if (all && !/^[^/\s]+\/\S+$/.test(all)) { appAlert(`"${all}" is not provider/model.`); return; }
  // The per-person and per-level rows save on their own (Assign): sent back as they are, so this keeps them.
  const body = { peopleModels: { same: card.querySelector('[data-pm="same"]').checked, choose: card.querySelector('[data-pm="choose"]').checked,
    assign: card.querySelector('[data-pm="assign"]').checked, all, levels: pol.levels || {}, people: pol.people || {} } };
  const said = card.querySelector('[data-pm-said]');
  try { await apiFetch('/api/prefs?replace=1', { method: 'POST', body }); said.textContent = 'Saved.'; }
  catch (e) { said.textContent = ''; appAlert(e.message); }
}

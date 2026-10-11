/* ═══════════════════════════════════════════════════════
   Settings → Spending (modules/spending; CONSTITUTION S12, docs/design/spending.md): what was spent — tokens from
   the usage ledger, money from the owner's price list — per person, per day and per month; budgets, which are
   opt-in (yours, an admin's for you, your level's: the tightest wins; the owner only their own); the spending
   permissions (settings/spending-permits.js). Every change asks for the password; the panel asks (lib/api.js).
   ═══════════════════════════════════════════════════════ */

let _spendingMonth = null;
let _spendingView = null;

const _SP_FIELDS = [['tokensPerDay', 'Tokens a day'], ['tokensPerMonth', 'Tokens a month'], ['moneyPerDay', 'Money a day'], ['moneyPerMonth', 'Money a month']];
// What each budget field means, for its ⓘ.
const _SP_INFO = {
  tokensPerDay: 'The most tokens (pieces of text the models read and write) the agents may use in one day, UTC. At the limit no new turn starts; one already running finishes. Empty or 0: no limit.',
  tokensPerMonth: 'The same, for a calendar month (UTC). Empty or 0: no limit.',
  moneyPerDay: 'The most money a day, priced with the list in Harness → Usage. While a money budget is set, a model with no price there is refused rather than guessed. Empty or 0: no limit.',
  moneyPerMonth: 'The same, for a calendar month (UTC). Empty or 0: no limit.',
};

const _spTok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
const _spMoney = (v, cur) => `${(v?.money || 0).toFixed(2)} ${escHtml(cur)}${v?.unpriced ? ` <span style="color:var(--muted)" title="Calls on models without a price are not counted in money">+${v.unpriced} unpriced</span>` : ''}`;

/** A budget in words: "200k tokens a day (their own), 5 USD a month (their level's)". */
function _spBudgetText(b, cur) {
  if (!b) return '<span style="color:var(--muted)">none</span>';
  const from = { own: 'own', admin: 'an admin\'s', leader: 'the team leader\'s', level: 'the level\'s' };
  return _SP_FIELDS.filter(([k]) => b[k]).map(([k, label]) => {
    const v = b[k].limit ?? b[k];
    return `${k.startsWith('tokens') ? _spTok(v) : `${v} ${escHtml(cur)}`} ${label.replace(/^(Tokens|Money) /, '')}${b[k].from ? ` <span style="color:var(--muted)">(${from[b[k].from]})</span>` : ''}`;
  }).join(', ');
}

/** Four inputs for a budget, ids prefixed. */
function _spBudgetInputs(prefix, b) {
  return _SP_FIELDS.map(([k, label]) => `<label style="font-size:11px;display:flex;flex-direction:column;gap:2px"><span>${label}${infoBtn(_SP_INFO[k])}</span>
    <input class="input" id="${prefix}-${k}" type="number" min="0" step="any" style="width:110px" value="${b?.[k] ?? ''}" placeholder="none" data-default="" data-label="${label}"></label>`).join('');
}
const _spBudgetRead = prefix => Object.fromEntries(_SP_FIELDS.map(([k]) => [k, document.getElementById(`${prefix}-${k}`)?.value || 0]));

async function spendingLoad(month) {
  const panel = document.getElementById('sp-spending');
  if (!panel) return;
  if (month) _spendingMonth = month;
  let v;
  try { v = await apiFetch(`/api/spending${_spendingMonth ? `?month=${encodeURIComponent(_spendingMonth)}` : ''}`); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  _spendingView = v;
  const cur = v.currency, me = v.me;
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
  const days = Object.entries(me.days || {}).sort(([a], [b]) => b.localeCompare(a)).map(([day, d]) =>
    `<div class="disk-row"><span class="disk-label">${escHtml(day)}</span><span class="disk-path">${_spTok(d.tokens)} tokens · ${d.calls} calls</span><span class="disk-free">${_spMoney(d, cur)}</span></div>`).join('');
  const people = v.admin ? (v.people || []).map(p => `<div class="disk-row">
      <span class="disk-label">${escHtml(p.name || p.email)} <span style="color:var(--muted)">${escHtml(p.role || '')}</span></span>
      <span class="disk-path">today ${_spTok(p.today?.tokens || 0)} · month ${_spTok(p.tokens)} tokens, ${_spMoney(p, cur)} · budget ${_spBudgetText(p.budget, cur)}</span>
      <span class="disk-free"><button class="btn btn-xs" onclick="spendingPickPerson(${jsArg(p.id)})">Budget…</button></span></div>`).join('')
    + (v.nobody ? `<div class="disk-row"><span class="disk-label" style="color:var(--muted)">Not anyone's</span><span class="disk-path">${_spTok(v.nobody.tokens)} tokens, ${_spMoney(v.nobody, cur)} — calls outside a person's conversation</span></div>` : '') : '';
  panel.innerHTML = `<div class="card">
    <div class="card-title">What was spent</div>
    <p class="desc" style="margin-bottom:6px">What your agents' model calls used, day by day.</p>
    <details class="desc page-about" style="margin-bottom:8px"><summary>What this is</summary>Every model call your agents made, counted in your conversations (and their missions and work chats).
      Money comes from the prices in Harness → Usage; a model without a price is counted in tokens only. Days and months are UTC.</details>
    <div class="toolbar" style="gap:8px;margin-bottom:8px"><span class="input-label" style="margin:0">Month${infoBtn('Which month to show, of the last six. Changing it only changes what is shown here.')}</span><select class="input" style="width:auto" aria-label="Month" onchange="spendingLoad(this.value)">
      ${months.map(m => `<option ${m === v.month ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <span style="font-size:12px">You: today <b>${_spTok(me.today?.tokens || 0)}</b> tokens, ${_spMoney(me.today, cur)} · this month <b>${_spTok(me.tokens)}</b> tokens, ${_spMoney(me, cur)}</span></div>
    ${days || '<div class="placeholder">Nothing spent this month.</div>'}
    ${v.admin ? `<div class="card-subtitle" style="margin-top:12px">Everyone, this month</div>${people}` : ''}</div>
  ${_spBudgetsCard(v)}
  <div id="spending-permits"></div>
  <div class="card" id="spending-holdings"></div>
  <div class="card"><div class="card-title">Payment method</div>
    <p style="font-size:12px;margin-bottom:4px"><span style="color:var(--muted)">○ none linked</span></p>
    <p style="font-size:11px;color:var(--muted)">${escHtml(v.payment.note)} Linking one — a payment provider's own saved method, never a card number
      kept here — comes in a later release; the permissions above are what it will spend within.</p></div>`;
  if ((v.admin || v.lead) && v.people?.length) spendingPickPerson(v.people[0].id, false);
  if (typeof spendingPermitsRender === 'function') spendingPermitsRender(v);
  if (typeof holdingsRender === 'function') holdingsRender('spending-holdings');   // what you have (settings/holdings.js)
}

function _spBudgetsCard(v) {
  const me = v.me, cur = v.currency;
  const levels = v.admin ? (v.levels || []).map(L => `<div class="disk-row" style="flex-wrap:wrap;gap:6px">
      <span class="disk-label">${escHtml(L.name)}</span>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap">${_spBudgetInputs(`sp-lv-${L.id}`, L.budget)}
        <label style="font-size:11px;display:flex;flex-direction:column;gap:2px"><span>May allow (${escHtml(cur)})${infoBtn('The most a person of this level may allow the agents to spend for them, counting their spending permissions still in effect and this month\'s one-time ones. Empty: nothing (a level that holds host: any amount).')}</span>
          <input class="input" id="sp-lv-${L.id}-allow" type="number" min="0" step="any" style="width:110px" data-default="" data-label="May allow" value="${L.mayAllow ?? ''}" placeholder="${L.holdsHost ? 'any' : 'nothing'}"></label>
        <button class="btn btn-xs btn-blue" style="align-self:flex-end" onclick="spendingSaveLevel(${jsArg(L.id)})">Save</button></div></div>`).join('') : '';
  return `<div class="card">
    <div class="card-title">Budgets</div>
    <p class="desc" style="margin-bottom:6px">Limits on how much the agents may use. Off unless somebody sets one.</p>
    <details class="desc page-about" style="margin-bottom:8px"><summary>What this is</summary>At a budget, a new turn is not started and says who can raise it;
      a turn already running finishes. At your own budget you are asked whether to go over it for that turn. Yours, an admin's for you and your level's all count — the tightest wins${me.role === 'owner' ? ' (as the owner, only your own applies to you)' : ''}.</details>
    <div style="font-size:12px;margin-bottom:8px">In effect for you: ${_spBudgetText(me.budget, cur)}</div>
    <div class="input-label">Your own budget${infoBtn('Limits you set on yourself. Empty or 0 in a box means no limit for it. When one is reached you are asked whether to go over it for that turn. Saving asks for your password.')}</div>
    <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${_spBudgetInputs('sp-own', me.own)}
      <button class="btn btn-sm btn-blue" style="align-self:flex-end" onclick="spendingSaveOwn()">Save</button></div>
    ${v.admin || v.lead ? advancedFold(`<div class="input-label">${v.admin ? 'A person\'s budget, set by an admin' : 'Your team\'s budgets, as their team leader'}${infoBtn('A budget you set for someone else. Their own, their level\'s and this one all count — the tightest wins — and at this one they are refused, not asked: only whoever set it can raise it.')}</div>
      <div class="toolbar" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <select class="input" id="sp-person" aria-label="Person" style="width:auto;align-self:flex-end" onchange="spendingPickPerson(this.value, false)">
          ${(v.people || []).map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.email)}</option>`).join('')}</select>
        <span id="sp-person-inputs" class="toolbar" style="gap:6px;flex-wrap:wrap;flex:1 1 260px;min-width:0"></span>
        <button class="btn btn-sm btn-blue" style="align-self:flex-end" onclick="spendingSavePerson()">Save</button></div>
      ${v.admin ? `<div class="input-label">Each level's default, and how much its people may allow themselves${infoBtn('A budget every person of the level starts with (theirs and an admin\'s still count: the tightest wins), and the most they may allow the agents to spend for them.')}</div>${levels}` : ''}`,
      { id: 'spending-others', label: v.admin ? 'Others\' budgets — a person\'s, each level\'s default' : 'Your team\'s budgets' }) : ''}</div>`;
}

function spendingPickPerson(id, scroll = true) {
  const sel = document.getElementById('sp-person');
  if (sel && sel.value !== id) sel.value = id;
  const p = (_spendingView?.people || []).find(x => x.id === id);
  const box = document.getElementById('sp-person-inputs');
  if (box) { box.innerHTML = _spBudgetInputs('sp-pp', p?.set); advancedFoldRefresh(box); }
  if (scroll) sel?.scrollIntoView?.({ block: 'nearest' });
}

async function _spSave(body) {
  try { await apiFetch('/api/spending/budget', { method: 'POST', body }); } catch (e) { return appAlert(e.message); }
  spendingLoad();
}
const spendingSaveOwn = () => _spSave({ budget: _spBudgetRead('sp-own') });
const spendingSavePerson = () => _spSave({ personId: document.getElementById('sp-person')?.value, budget: _spBudgetRead('sp-pp') });
const spendingSaveLevel = id => _spSave({ levelId: id, budget: _spBudgetRead(`sp-lv-${id}`), mayAllow: document.getElementById(`sp-lv-${id}-allow`)?.value ?? '' });

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-spending' })));

/* ═══════════════════════════════════════════════════════
   DOCA PANEL — TOKENS PER PROVIDER (Field → API keys)
   What each provider was used for — today, this month, in all — from the usage ledger (GET /api/usage/providers: the
   hive's for a host, else the person's own), money where the owner priced the model ("no price" otherwise, never 0),
   each model in a fold; and what OpenRouter or DeepSeek say of their own (GET /api/keys/balances, a host's), labelled
   as theirs. Asked when the page draws, never on a timer.
   ═══════════════════════════════════════════════════════ */

const _KU_SPANS = [['today', 'Today'], ['month', 'This month'], ['all', 'In all']];

function _kuMoney(t, cur) {
  if (!t || !t.calls) return '—';
  if (t.money === null) return '<span class="kuse-muted" title="No model used here has a price in Harness → Usage">no price</span>';
  const part = t.unpriced ? ` <span class="kuse-muted" title="Calls on models without a price are not in this sum">+${t.unpriced} ${t.unpriced === 1 ? 'call' : 'calls'} with no price</span>` : '';
  return `${t.money.toFixed(t.money < 1 ? 4 : 2)} ${escHtml(cur)}${part}`;
}

function _kuCell(t, cur) {
  if (!t || !t.calls) return '<td class="kuse-muted">—</td>';
  const est = t.estimated ? ` title="${t.estimated} of ${t.calls} calls were estimated: the provider did not report them"` : '';
  return `<td${est}>${fmtNumber(t.prompt)} in · ${fmtNumber(t.completion)} out · ${fmtNumber(t.cached)} cached${t.estimated ? ' ~' : ''}<br>`
    + `<span class="kuse-money">${_kuMoney(t, cur)}</span></td>`;
}

function _kuTable(rows, cur, first) {
  return `<table class="kuse-table"><thead><tr><th>${escHtml(first)}</th>${_KU_SPANS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(r => `<tr><td class="kuse-name">${escHtml(r.name)}</td>${_KU_SPANS.map(([s]) => _kuCell(r[s], cur)).join('')}</tr>`).join('')
    + '</tbody></table>';
}

/** The provider's own figure, said as theirs. */
function _kuBalanceHtml(b) {
  if (!b) return '';
  const who = escHtml(b.label || b.provider);
  if (!b.ok) return `<div class="kuse-theirs kuse-muted">${who}'s own figure could not be read: ${escHtml(b.error || 'no answer')}.</div>`;
  const f = b.figure || {}, cur = escHtml(f.currency || '');
  const n = v => (v === null || v === undefined ? null : `${Number(v).toFixed(2)} ${cur}`);
  const parts = [];
  if (f.used !== undefined && f.used !== null) parts.push(`used ${n(f.used)}`);
  if (f.limit !== undefined) parts.push(f.limit === null ? 'no limit on this key' : `this key's limit ${n(f.limit)}`);
  if (f.remaining !== undefined && f.remaining !== null) parts.push(`${n(f.remaining)} left on the key`);
  // What the account holds is what a request is refused for, whatever the key's limit says (2026-10-17).
  if (f.credit !== undefined && f.credit !== null) parts.push(`<b>account credit ${n(f.credit)} left</b>`);
  if (f.balance !== undefined && f.balance !== null) parts.push(`balance ${n(f.balance)}`);
  for (const o of f.others || []) if (o.balance !== null) parts.push(`balance ${o.balance.toFixed(2)} ${escHtml(o.currency)}`);
  if (f.note) parts.push(escHtml(f.note));
  const at = b.at ? ` title="Asked ${escHtml(new Date(b.at).toLocaleTimeString())}; kept 5 minutes"` : '';
  return `<div class="kuse-theirs"${at}><span class="kuse-tag">${who}'s figure</span> ${parts.join(' · ') || 'nothing reported'}</div>`;
}

function _kuBlockHtml(id, u, cur, balance) {
  if (!u && !balance) return '';
  const head = u ? _kuTable([{ name: 'Used here', ...u }], cur, 'Tokens') : '<div class="kuse-muted">Not used through DOCA yet.</div>';
  const models = u?.models?.length
    ? `<details class="kuse-models"><summary>Per model (${u.models.length})</summary>${_kuTable(u.models.map(m => ({ name: m.model || '(unnamed)', ...m })), cur, 'Model')}</details>` : '';
  return `${head}${_kuBalanceHtml(balance)}${models}`;
}

/** Fill every provider row's usage slot (`key-usage-<name>`); a provider never used shows only its own figure, if any. */
async function keysUsageLoad() {
  const host = !(typeof _settingsNoHost !== 'undefined' && _settingsNoHost);
  let usage = { providers: {}, currency: 'USD' }, balances = {};
  const [u, b] = await Promise.allSettled([apiFetch('/api/usage/providers'), host ? apiFetch('/api/keys/balances') : Promise.resolve({ balances: {} })]);
  if (u.status === 'fulfilled') usage = u.value;
  if (b.status === 'fulfilled') balances = b.value.balances || {};
  document.querySelectorAll('[id^="key-usage-"]').forEach(slot => {
    const id = slot.id.slice('key-usage-'.length);
    slot.innerHTML = u.status === 'rejected' ? `<div class="kuse-muted">Usage could not be read: ${escHtml(u.reason?.message || '')}</div>`
      : _kuBlockHtml(id, usage.providers[id], usage.currency, balances[id]);
  });
  if (!host) keysUsageMine(usage);
}

/** Without host there are no provider rows: the person's own use per provider, in a card of its own. */
function keysUsageMine(usage) {
  const anchor = document.getElementById('providers-list')?.closest('.card');
  if (!anchor) return;
  let card = document.getElementById('kuse-mine');
  if (!card) {
    card = document.createElement('div');
    card.id = 'kuse-mine'; card.className = 'card mt8';
    anchor.parentNode.insertBefore(card, anchor);
  }
  const ids = Object.keys(usage.providers || {});
  card.innerHTML = '<div class="card-title">Your use of each provider</div>'
    + (ids.length ? ids.map(id => `<div class="provider-card"><div class="provider-header"><span class="provider-name">${escHtml(id || '(none)')}</span></div>${_kuBlockHtml(id, usage.providers[id], usage.currency)}</div>`).join('')
      : '<div class="placeholder">Your agents have not used a provider yet.</div>');
}

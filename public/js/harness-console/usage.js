/* ═══════════════════════════════════════════════════════
   Harness tab: what the model calls used and cost, per model, from the
   owner's own price list (modules/harness/prices.js). Opened from the
   "24h …" line beside the model badge.
   ═══════════════════════════════════════════════════════ */

let _hcUsageDays = 7;

const _hcFmtTok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function hcUsageOpen() {
  let overlay = document.getElementById('hc-usage-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hc-usage-overlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '980px';
    modal.innerHTML = `
      <div class="modal-title">Usage</div>
      <div id="hc-usage-days" style="display:flex;gap:6px;margin-bottom:8px"></div>
      <div id="hc-usage-body" style="overflow-x:auto"></div>
      <small class="harness-hint">Every model call this harness made: turns, summaries and one-off asks. Prices are yours,
        per million tokens — none are shipped, because a built-in price list is out of date the day it is released.
        A model without a price shows "no price", never 0; type 0 for a model that is free.</small>
      <div class="toolbar-right mt8">
        <label class="harness-hint">Currency <input class="input" id="hc-usage-currency" style="width:70px"></label>
        <button class="btn btn-xs btn-blue" id="hc-usage-save">Save prices</button>
        <span class="status-line" id="hc-usage-status"></span>
        <button class="btn btn-xs" id="hc-usage-close">close</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('#hc-usage-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    modal.querySelector('#hc-usage-save').addEventListener('click', hcUsageSavePrices);
    const days = modal.querySelector('#hc-usage-days');
    for (const d of [1, 7, 30, 90]) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs', textContent: d === 1 ? '24 h' : `${d} days` });
      b.dataset.days = d;
      b.addEventListener('click', () => { _hcUsageDays = d; hcUsageLoad(); });
      days.appendChild(b);
    }
  }
  overlay.style.display = 'flex';
  hcUsageLoad();
}

async function hcUsageLoad() {
  const body = document.getElementById('hc-usage-body');
  if (!body) return;
  document.querySelectorAll('#hc-usage-days button').forEach(b => b.classList.toggle('btn-blue', Number(b.dataset.days) === _hcUsageDays));
  body.textContent = 'Loading…';
  let u;
  try { u = await apiFetch(`/api/harness/usage?days=${_hcUsageDays}&by=model`); }
  catch (e) { body.textContent = e.message; return; }
  document.getElementById('hc-usage-currency').value = u.currency || 'USD';
  const money = v => (v === null || v === undefined ? 'no price' : `${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)} ${u.currency}`);
  const box = (key, field) => {
    const v = u.prices?.[key]?.[field];
    return `<input class="input" type="number" min="0" step="0.01" style="width:72px" data-key="${escHtml(key)}" data-field="${field}" value="${v === null || v === undefined ? '' : escHtml(String(v))}">`;
  };
  if (!u.rows.length) { body.innerHTML = '<div class="placeholder">No model calls in this period.</div>'; return; }
  body.innerHTML = `
    <table class="models-table">
      <thead><tr><th>Model</th><th>Calls</th><th>Prompt</th><th>Cached</th><th>Reply</th><th>Cost</th>
        <th title="${escHtml(u.currency)} per million prompt tokens">In / M</th><th title="Per million cached prompt tokens; blank = same as In">Cached / M</th><th title="Per million reply tokens">Out / M</th></tr></thead>
      <tbody>${u.rows.map(r => `<tr>
        <td>${escHtml(r.key)}${r.estimated ? ` <small title="${r.estimated} of these calls had no usage report; their tokens are estimated">~est</small>` : ''}</td>
        <td>${r.calls}</td><td>${_hcFmtTok(r.prompt)}</td>
        <td>${r.prompt ? `${Math.round(r.cached / r.prompt * 100)}%` : '—'}</td><td>${_hcFmtTok(r.completion)}</td>
        <td>${escHtml(money(r.cost))}</td>
        <td>${box(r.key, 'input')}</td><td>${box(r.key, 'cached')}</td><td>${box(r.key, 'output')}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><th>Total</th><th>${u.total.calls}</th><th>${_hcFmtTok(u.total.prompt)}</th>
        <th>${u.total.prompt ? `${Math.round(u.total.cached / u.total.prompt * 100)}%` : '—'}</th><th>${_hcFmtTok(u.total.completion)}</th>
        <th>${escHtml(money(u.cost))}${u.unpriced ? `<br><small>${u.unpriced} model${u.unpriced === 1 ? '' : 's'} without a price not counted</small>` : ''}</th><th colspan="3"></th></tr></tfoot>
    </table>`;
}

async function hcUsageSavePrices() {
  const status = document.getElementById('hc-usage-status');
  const prev = (await apiFetch(`/api/harness/usage?days=1&by=model`).catch(() => ({}))).prices || {};
  const models = { ...prev };
  for (const input of document.querySelectorAll('#hc-usage-body input[data-key]')) {
    const key = input.dataset.key;
    models[key] = { ...(models[key] || {}), [input.dataset.field]: input.value === '' ? null : Number(input.value) };
  }
  try {
    await apiFetch('/api/harness/usage/prices', { method: 'POST', body: { currency: document.getElementById('hc-usage-currency').value || 'USD', models } });
    status.textContent = 'Saved.';
    hcUsageLoad();
  } catch (e) { status.textContent = e.message; }
}

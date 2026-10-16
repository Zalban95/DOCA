/* ═══════════════════════════════════════════════════════
   Settings → Set-up: a mastermind and a worker, per budget (modules/guided/pairs.js).
   Offered only from providers whose key is here; a missing key is pasted in
   Field → API keys, never in a chat. "Use this pair" checks both models against
   the provider's own list, then saves the two settings through POST /api/prefs.
   ═══════════════════════════════════════════════════════ */

function guidedPairsDraw(pairs) {
  const box = document.getElementById('guided-pairs');
  if (!box) return;
  if (!pairs?.budgets?.length) { box.innerHTML = ''; return; }
  const one = e => `<b>${escHtml(e.name)}</b> <span class="guided-muted">(${escHtml(e.provider)}; index ${escHtml(String(e.index))}, $${escHtml(String(e.usdPerM))}/M${e.tokPerSec ? `, ${escHtml(String(e.tokPerSec))} tok/s` : ''})</span>`;
  const row = b => `<div class="guided-pair">
      <div><b>${escHtml(b.label)}</b> — ${escHtml(b.what || '')}</div>
      ${b.ready ? `<div>mastermind: ${one(b.mastermind)} · worker: ${one(b.worker)}</div>
        ${b.chosen ? '<span style="color:var(--green)">✓ in use</span>' : `<button class="btn btn-xs" onclick="guidedPairUse(${jsArg(b.id)}, this)">Use this pair</button>`}`
      : `<div class="guided-muted">Needs a key for ${b.missing.map(m => m.keyPage ? `<a href="${escHtml(m.keyPage)}" target="_blank" rel="noopener">${escHtml(m.label)}</a>` : escHtml(m.label)).join(' or ')} — paste it in <a href="#settings/keys" onclick="settingsSubNav('keys'); return false">Field → API keys</a>.</div>`}
    </div>`;
  const cur = pairs.current || {};
  box.innerHTML = `<div class="guided-q"><div class="guided-q-title">Two models: one decides, one does${infoBtn(pairs.about || '')}</div>
    <p class="guided-muted">A stronger model plans and reviews (the mastermind); a quicker, cheaper one carries out the steps (the worker). From ${escHtml(pairs.source || 'the project\'s list')}.
      Now: mastermind <b>${escHtml(cur.mastermind || 'the agent\'s model')}</b>, worker <b>${escHtml(cur.worker || 'the agent\'s model')}</b>.</p>
    ${pairs.budgets.map(row).join('')}
    <span class="status-line" id="guided-pairs-status"></span></div>`;
}

async function guidedPairUse(budget, btn) {
  const st = document.getElementById('guided-pairs-status');
  if (btn) btn.disabled = true;
  setStatus(st, 'checking the provider\'s model list…', 'info');
  try {
    const r = await apiFetch('/api/guided/pairs/check', { method: 'POST', body: { budget } });
    const prefs = await apiFetch('/api/prefs');
    const harness = JSON.parse(JSON.stringify(prefs.harness || {}));
    harness.models = { ...(harness.models || {}), mastermind: r.values.mastermind, worker: r.values.worker };
    await apiFetch('/api/prefs', { method: 'POST', body: { harness } });
    setStatus(st, `✓ Mastermind ${r.values.mastermind}, worker ${r.values.worker}. Change or clear them under Controls → DOCA ⚙ → Advanced.`, 'ok', { clear: 0 });
    if (typeof guidedLoad === 'function') setTimeout(guidedLoad, 1500);
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err', { clear: 0 }); }
  finally { if (btn) btn.disabled = false; }
}

/* ═══════════════════════════════════════════════════════
   Harness tab: the agent's memory, and the rules it is kept by.
   ═══════════════════════════════════════════════════════ */

async function _hcLoadMemory() {
  const el = document.getElementById('hc-memory');
  if (!el) return;
  try {
    const { entries } = await apiFetch('/api/harness/memory');
    el.innerHTML = entries.map(e => `
      <div class="hc-mem ${e.pinned ? 'pinned' : ''}" title="${escHtml(e.value)}">
        <span class="hc-mem-key">${e.pinned ? '📌 ' : ''}${escHtml(e.key)}</span>
        <span class="hc-mem-val">${escHtml(e.value)}</span>
        <button class="btn btn-xs btn-red" onclick="hcMemForget(${jsArg(e.key)})" title="Forget">✕</button>
      </div>`).join('') || '<div class="placeholder">Nothing remembered yet</div>';
  } catch (e) {
    el.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

async function hcMemWrite() {
  const key = document.getElementById('hc-mem-key');
  const val = document.getElementById('hc-mem-value');
  if (!key?.value.trim() || !val?.value.trim()) return;
  try {
    await apiFetch('/api/harness/memory', { method: 'POST', body: { key: key.value.trim(), value: val.value.trim() } });
    key.value = val.value = '';
    _hcLoadMemory();
  } catch (e) { appAlert(e.message); }
}

function hcMemForget(key) {
  appConfirm(`Forget "${key}"?`, async () => {
    try {
      await apiFetch(`/api/harness/memory/${encodeURIComponent(key)}`, { method: 'DELETE' });
      _hcLoadMemory();
    } catch (e) { appAlert(e.message); }
  });
}

/* ── The rules memory is kept by ──────────────────────── */

function hcRulesOpen() {
  const overlay = document.getElementById('hc-rules-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _hcRulesFill();
}

async function _hcRulesFill(source) {
  const cats  = document.getElementById('hc-rules-cats');
  const rules = document.getElementById('hc-rules-list');
  // A review describes the text it was given, so it stops being true the
  // moment the editor is refilled with another version of the rules.
  _hcRulesReview(null);
  try {
    const doc = source || (await apiFetch('/api/harness/memory/rules')).rules;
    if (cats)  cats.value  = doc.categories.map(c => `${c.id}: ${c.description || ''}`.trim()).join('\n');
    if (rules) rules.value = doc.rules.join('\n');
    setStatus(document.getElementById('hc-rules-status'),
      doc.source === 'default' ? 'The rules DOCA ships with.'
        : `Last changed by the ${doc.source === 'agent' ? 'agent' : 'user'}.`, '');
  } catch (e) { setStatus(document.getElementById('hc-rules-status'), e.message, 'err'); }
}

function hcRulesClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hc-rules-overlay');
  if (overlay) overlay.style.display = 'none';
}

/** `id: description` per line — the same shape the modal shows. */
function _hcParseCategories(text) {
  return text.split('\n').map(line => {
    const [id, ...rest] = line.split(':');
    return { id: (id || '').trim(), description: rest.join(':').trim() };
  }).filter(c => c.id);
}

/** What the two textareas currently say, in the shape both endpoints take. */
function _hcRulesDraft() {
  return {
    categories: _hcParseCategories(document.getElementById('hc-rules-cats').value),
    rules:      document.getElementById('hc-rules-list').value.split('\n').map(r => r.trim()).filter(Boolean),
  };
}

/**
 * Fill the review panel, or hide it with `null`.
 *
 * `head` and `text` are set as text and never as markup: `text` is prose a
 * model wrote, and the model is the one thing here nobody vouches for.
 */
function _hcRulesReview(text, head) {
  const box = document.getElementById('hc-rules-review');
  if (!box) return;
  box.textContent = '';
  if (text == null) { box.style.display = 'none'; return; }
  if (head) {
    const line = document.createElement('div');
    line.className = 'hc-rules-review-head';
    line.textContent = head;
    box.appendChild(line);
  }
  const body = document.createElement('div');
  body.className = 'hc-rules-review-text';
  body.textContent = text;
  box.appendChild(body);
  box.style.display = 'block';
}

async function hcRulesSave() {
  const st = document.getElementById('hc-rules-status');
  try {
    const { rules } = await apiFetch('/api/harness/memory/rules', {
      method: 'POST',
      body: _hcRulesDraft(),
    });
    _hcRulesFill(rules);
    setStatus(st, '✓ Saved — in force from the next message', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * Have the rules read back for conflicts, vague wording and gaps.
 *
 * The editor's own text is sent rather than what is stored, so a draft can be
 * checked before it is saved — and because the review writes nothing either
 * way, reading one is never a step towards a change nobody asked for. It goes
 * through a model, so it takes seconds: the button says so while it waits.
 */
async function hcRulesVerify() {
  const btn = document.getElementById('hc-rules-verify');
  const was = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Reading…'; }
  _hcRulesReview('Reading the rules — this goes through the model, so give it a few seconds.');
  try {
    const data = await apiFetch('/api/harness/memory/rules/verify', { method: 'POST', body: _hcRulesDraft() });
    const { categories, rules } = data.checked;
    _hcRulesReview(data.review || 'The model answered with nothing.',
      `${data.saved ? 'The saved rules' : 'The draft above, unsaved'} — `
      + `${categories} categor${categories === 1 ? 'y' : 'ies'}, ${rules} rule${rules === 1 ? '' : 's'} read. `
      + 'Nothing was changed.');
  } catch (e) {
    _hcRulesReview(null);
    appAlert(`Error: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = was; }
  }
}

function hcRulesReset() {
  appConfirm('Go back to the memory rules DOCA ships with? Anything you or the agent changed here is lost.',
    async () => {
      try {
        const { rules } = await apiFetch('/api/harness/memory/rules', { method: 'DELETE' });
        _hcRulesFill(rules);
        setStatus(document.getElementById('hc-rules-status'), '↺ Back to the shipped rules', 'warn');
      } catch (e) { setStatus(document.getElementById('hc-rules-status'), `✗ ${e.message}`, 'err'); }
    });
}

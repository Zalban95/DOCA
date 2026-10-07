/* Settings → Developer → Releasing (modules/releasing.js; CONSTITUTION W2): which models may merge, tag, push and
   switch the live panel without asking. A family per line, optionally with a minimum version (claude-opus >= 5); an
   empty list means every model asks. The admin's alone: the agents read it, none may change it. */
async function releasingCard(panel) {
  let r;
  try { r = await apiFetch('/api/developer/releasing'); } catch { return; }
  const card = Object.assign(document.createElement('div'), { className: 'card form-help-skip', id: 'releasing-card' });   // no ✨: what governs the agents is not theirs to draft
  card.innerHTML = `<div class="card-title">Releasing</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Models that may release DOCA without asking — merge, tag, push and switch this panel to the new
      version — whether they work through DOCA's own agent, the model scout or a coding tool on this repository. Any other model asks first.
      One family per line, optionally with a minimum version. Empty: everyone asks.</p>
    <textarea class="input" id="rel-rules" rows="4" style="width:100%;font-family:var(--font-mono)">${escHtml(r.rules.join('\n'))}</textarea>
    <div class="toolbar" style="gap:6px;margin-top:6px;flex-wrap:wrap">
      <button class="btn btn-sm btn-primary" onclick="releasingSave()">Save</button>
      <span class="status-line" id="rel-status"></span>
    </div>
    <div class="form-row" style="margin-top:12px">   <!-- "Would it ask?" is its own row with its answer beside it (des 24) -->
      <label style="display:flex;flex-direction:column;gap:4px"><span class="input-label" style="margin:0">Would a model ask before releasing?</span>
        <input class="input" id="rel-try" placeholder="a model id, e.g. claude-opus-5-5"></label>
      <button class="btn btn-sm" onclick="releasingTry()">Check</button>
      <span class="status-line" id="rel-try-result" style="flex:1 1 200px"></span>
    </div>`;
  panel.append(card);
}

async function releasingSave() {
  const rules = document.getElementById('rel-rules').value.split('\n').map(s => s.trim()).filter(Boolean);
  const st = document.getElementById('rel-status');
  try { await apiFetch('/api/developer/releasing', { method: 'POST', body: { rules } }); setStatus(st, '✓ Saved', 'ok'); }
  catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function releasingTry() {
  const model = document.getElementById('rel-try').value.trim(), st = document.getElementById('rel-try-result');
  if (!model) return;
  try {
    const r = await apiFetch(`/api/developer/releasing?model=${encodeURIComponent(model)}`);
    setStatus(st, r.unasked ? `Releases without asking (${r.rule})` : 'Asks before releasing', r.unasked ? 'ok' : '');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

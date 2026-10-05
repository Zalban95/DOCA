/* ═══════════════════════════════════════════════════════
   Settings → Experiments (modules/experiments.js; hive.md §8): new approaches
   behind a switch, off by default, each with its write-up beside it — what it
   tries, what is measured, what it costs, what can go wrong, how it is undone.
   ═══════════════════════════════════════════════════════ */

async function experimentsLoad() {
  const panel = document.getElementById('sp-experiments');
  if (!panel) return;
  let list;
  try { ({ experiments: list } = await apiFetch('/api/experiments')); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = `<div class="card"><div class="card-title">Experiments</div>
    <p style="font-size:11px;color:var(--muted)">Each is off until you switch it on, and is undone by switching it off. Read what it costs and what can go wrong first.</p></div>`;
  for (const x of list) {
    const card = Object.assign(document.createElement('div'), { className: 'card' });
    card.innerHTML = `<div class="card-title" style="display:flex;align-items:center;gap:10px">${escHtml(x.label)}
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;text-transform:none;letter-spacing:0"><input type="checkbox" ${x.on ? 'checked' : ''}
          onchange="experimentsSet(${jsArg(x.id)}, this.checked)"> on</label><span style="color:var(--muted);font-size:11px">${escHtml(x.todo || '')}</span></div>
      <div class="exp-doc" style="font-size:12px;max-height:340px;overflow:auto"></div>`;
    mdInto(card.querySelector('.exp-doc'), x.docText);
    panel.append(card);
  }
}

async function experimentsSet(id, on) {
  try { await apiFetch(`/api/experiments/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  experimentsLoad();
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-experiments' })));

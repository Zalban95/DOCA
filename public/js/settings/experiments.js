/* ═══════════════════════════════════════════════════════
   Settings → Developer (modules/experiments.js; hive.md §8): developer mode, and
   the experiments it offers — new approaches behind a switch, off by default, each
   with its write-up beside it (what it tries, what is measured, what it costs, what
   can go wrong, how it is undone). Without developer mode none is offered or in
   effect: a customer's install never meets them. An owner's or a tester's switch.
   ═══════════════════════════════════════════════════════ */

async function experimentsLoad() {
  const panel = document.getElementById('sp-experiments');
  if (!panel) return;
  let list, dev;
  try { ({ experiments: list, developer: dev } = await apiFetch('/api/experiments')); }
  catch (e) { panel.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  panel.innerHTML = `<div class="card"><div class="card-title">Developer mode</div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" ${dev ? 'checked' : ''} onchange="experimentsDeveloper(this.checked)">
      Developer mode on this install</label>
    <p style="font-size:11px;color:var(--muted);margin-top:6px">For the people who build and test DOCA. On, the experiments below are offered and the ones switched on
      take effect; off, none is — whatever their switches say — and the panel shows none of them. Each is off until switched on and undone by
      switching it off: read what it costs and what can go wrong first.</p></div>`;
  if (!dev) return;
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

async function experimentsDeveloper(on) {
  try { await apiFetch('/api/experiments/developer', { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  if (typeof screenLoad === 'function') await screenLoad(true);
  if (typeof wakeWordApply === 'function') wakeWordApply();
  experimentsLoad();
}

async function experimentsSet(id, on) {
  try { await apiFetch(`/api/experiments/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); }
  experimentsLoad();
}

// Its panel is made here rather than in index.html, which is at its line ceiling.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () =>
  document.getElementById('sp-backups')?.before(Object.assign(document.createElement('div'), { className: 'settings-panel', id: 'sp-experiments' })));

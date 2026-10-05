/* Settings → Harness → Scout (modules/scout; experiment modelScout): the model scout — what it watches, switching the
   routine on, a look or a brief now, and the suggestions it filed, each accepted (a line in TODO.md, then "Start the
   work" with DOCA's agent or a CLI harness) or declined with a reason the next brief reads. A host's. */
async function scoutCardRender(panel) {
  let v;
  try { v = await apiFetch('/api/scout'); } catch { return; }
  document.getElementById('scout-card')?.remove();
  if (!v.experiment) return;   // developer mode and the experiment: otherwise there is nothing to show
  const s = v.settings, st = v.state || {};
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'scout-card' });
  const badge = x => ({ pending: 'var(--accent)', accepted: 'var(--green)', working: 'var(--blue, var(--accent))', done: 'var(--green)', declined: 'var(--muted)', failed: 'var(--red)' }[x] || 'var(--muted)');
  const row = x => `<div style="border-top:1px solid var(--border2);padding:8px 0;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${escHtml(x.id)}</b> ${escHtml(x.title)}
        <span style="font-size:10px;color:${badge(x.state)};text-transform:uppercase">${escHtml(x.state)}</span>
        <span style="font-size:11px;color:var(--muted)">${escHtml(x.role)}${x.candidate ? ` · ${escHtml(x.candidate)}` : ''}${x.replaces ? ` · replaces ${escHtml(x.replaces)}` : ''}</span></div>
      <div style="font-size:12px;white-space:pre-wrap">${escHtml(x.why)}</div>
      ${x.tryWith ? `<div style="font-size:11px;color:var(--muted)">Try: ${escHtml(x.tryWith)}</div>` : ''}
      ${x.evidence?.length ? `<div style="font-size:11px">${x.evidence.map(e => /^https?:\/\//.test(e) ? `<a href="${escHtml(e)}" target="_blank" rel="noopener noreferrer">${escHtml(e)}</a>` : escHtml(e)).join(' · ')}</div>` : ''}
      ${x.reason ? `<div style="font-size:11px;color:var(--muted)">Declined: ${escHtml(x.reason)}</div>` : ''}
      ${x.error ? `<div style="font-size:11px;color:var(--red)">${escHtml(x.error)}</div>` : ''}
      <div class="toolbar" style="gap:6px">
        ${x.state === 'pending' ? `<button class="btn btn-xs btn-teal" onclick="scoutDecide('${x.id}','accept')">Accept → TODO</button>
          <button class="btn btn-xs" onclick="scoutDecide('${x.id}','decline')">Decline…</button>` : ''}
        ${['accepted', 'failed'].includes(x.state) ? `<button class="btn btn-xs btn-blue" onclick="scoutDecide('${x.id}','work')">Start the work (${escHtml(s.implementer)})</button>` : ''}
        ${x.sessionId ? `<button class="btn btn-xs" onclick="nav('harness'); hcOpenSession(${jsArg(x.sessionId)})">Open its conversation</button>` : ''}
      </div></div>`;
  card.innerHTML = `<div class="card-title">Model scout <span style="font-size:10px;color:var(--muted)">experiment</span></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Looks daily at Hugging Face's trending models for each function DOCA uses, the releases of
      what it runs on and your news feeds; every ${s.everyDays} days — or at once when something grows fast — the agent reads the promising ones and
      suggests what could do a function better or add a new one. Nothing changes until you accept: an accepted suggestion becomes a line in
      <code>${escHtml(v.repo || '(no repository)')}/TODO.md</code>, and "Start the work" hands it to ${escHtml(s.implementer === 'doca' ? 'DOCA\'s agent' : s.implementer)}.
      Last look: ${escHtml(st.lastLookAt || 'never')} · last brief: ${escHtml(st.lastBriefAt || 'never')}${st.lastBriefWhy ? ` (${escHtml(st.lastBriefWhy)})` : ''}</p>
    <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="scoutEnable(this.checked)"> The routine (daily look, briefs)</label>
      <button class="btn btn-sm" onclick="scoutLook()">Look now</button>
      <button class="btn btn-sm btn-blue" onclick="scoutBrief()">Scout now</button>
    </div>
    <details style="font-size:12px;margin-bottom:8px"><summary>What it watches</summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        <label>Every <input class="input" id="scout-every" type="number" min="1" value="${s.everyDays}" style="width:70px"> days ·
          growing fast at <input class="input" id="scout-growth" type="number" min="1" value="${s.growthLikes}" style="width:80px"> new likes</label>
        <label>Releases (GitHub owner/repo, one a line)<textarea class="input" id="scout-watch" rows="4">${escHtml(s.watch.join('\n'))}</textarea></label>
        <label>News feeds (RSS or Atom)<textarea class="input" id="scout-feeds" rows="2">${escHtml(s.feeds.join('\n'))}</textarea></label>
        <label>Repository for TODO.md <input class="input" id="scout-repo" value="${escHtml(s.repo)}" placeholder="${escHtml(v.repo || '')}" style="width:min(420px,70vw)"></label>
        <label>Implementer <input class="input" id="scout-impl" value="${escHtml(s.implementer)}" placeholder="doca, claude, codex…" style="width:140px"></label>
        <div><button class="btn btn-sm btn-blue" onclick="scoutSave()">Save</button></div>
      </div></details>
    <pre class="terminal" id="scout-out" style="display:none;max-height:260px;white-space:pre-wrap"></pre>
    ${v.suggestions.map(row).join('') || '<div class="placeholder" style="font-size:12px">No suggestions yet.</div>'}`;
  panel.append(card);
}

const _scoutRedraw = () => scoutCardRender(document.getElementById('sp-harness'));

async function scoutEnable(on) { try { await apiFetch('/api/scout/enable', { method: 'POST', body: { on } }); } catch (e) { appAlert(e.message); } _scoutRedraw(); }

async function scoutSave() {
  const g = id => document.getElementById(id).value;
  const lines = id => g(id).split('\n').map(x => x.trim()).filter(Boolean);
  try {
    await apiFetch('/api/scout/settings', { method: 'POST', body: { everyDays: Number(g('scout-every')), growthLikes: Number(g('scout-growth')),
      watch: lines('scout-watch'), feeds: lines('scout-feeds'), repo: g('scout-repo').trim(), implementer: g('scout-impl').trim() || 'doca' } });
  } catch (e) { return appAlert(e.message); }
  _scoutRedraw();
}

async function scoutLook() {
  const out = document.getElementById('scout-out');
  out.style.display = ''; out.textContent = 'Looking…';
  try { out.textContent = (await apiFetch('/api/scout/look', { method: 'POST', body: {} })).brief; } catch (e) { out.textContent = `✗ ${e.message}`; }
}

async function scoutBrief() {
  try { await apiFetch('/api/scout/brief', { method: 'POST', body: {} }); appAlert('The scout is working in its conversation "Model scout"; suggestions appear here as it files them.'); }
  catch (e) { appAlert(e.message); }
  _scoutRedraw();
}

async function scoutDecide(id, what, reason) {
  if (what === 'decline' && reason === undefined)
    return appPrompt('Why not? The next brief reads this, so it is not suggested again.', r => scoutDecide(id, what, r), '', { allowEmpty: true });
  const body = what === 'decline' ? { reason } : {};
  try { await apiFetch(`/api/scout/${encodeURIComponent(id)}/${what}`, { method: 'POST', body }); } catch (e) { appAlert(e.message); }
  _scoutRedraw();
}

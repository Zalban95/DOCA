/* Settings → Harness → Retrieval (modules/retrieval; TODO H10.2, an experiment): the embedding model that lets
   memory_search and recall_conversations find by meaning, what the index holds, and a try. The switch is
   Settings → Developer. */
async function retrievalCardRender(panel) {
  let r;
  if (!(typeof licenceFeatureOn !== 'function' || licenceFeatureOn('retrieval'))) return;
  try { r = await apiFetch('/api/retrieval'); } catch { return; }
  document.getElementById('retrieval-card')?.remove();
  if (!r.experiment && !r.on) return;   // its experiment is off (Settings → Developer): nothing to set yet
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'retrieval-card' });
  const idx = (r.index || []).map(x => `${escHtml(x.source)}: ${x.refs} (${x.chunks} pieces, ${escHtml(x.model)})`).join(' · ') || 'empty';
  card.innerHTML = `<div class="card-title">Retrieval <span style="font-size:10px;color:var(--muted)">experiment</span></div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:4px">State: <b>${r.on ? 'on' : r.experiment ? 'switched on, but no model' : 'off'}</b> · index: ${idx}</p>
    <details class="desc page-about" style="font-size:11px;color:var(--muted);margin-bottom:10px"><summary>What this is</summary>With an embedding model here and the switch on in Experiments, <code>memory_search</code> and
      <code>recall_conversations</code> also find by meaning — "the printer thing" finds the entry about the 3D printer's port. Only what changed is embedded again.</details>
    <div class="input-label">Embedding model${infoBtn('The model that turns text into numbers so memory and conversations can be found by meaning: its provider (as in Field → API keys; Ollama for one on this machine — the default) and its name, such as nomic-embed-text. Empty: search by keywords only.')}</div>
    <div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <input class="input" id="retrieval-provider" placeholder="provider (ollama)" value="${escHtml(r.provider || '')}" style="width:160px">
      <input class="input" id="retrieval-model" placeholder="embedding model, e.g. nomic-embed-text" value="${escHtml(r.model || '')}" style="flex:1;min-width:220px">
    </div>
    <button class="btn btn-sm btn-blue" onclick="retrievalSave()">Save</button>
    <button class="btn btn-sm" onclick="retrievalTry()" ${r.model ? '' : 'disabled'}>Try on memory</button>
    <button class="btn btn-sm" onclick="retrievalClear()">Empty the index</button>
    <input class="input" id="retrieval-q" placeholder="something to look for" style="width:220px;margin-left:6px">${infoBtn('Words to look for with Try on memory, to see what finding by meaning returns. Empty: a sample question. Nothing is saved.')}
    <pre class="terminal" id="retrieval-out" style="display:none;margin-top:8px;max-height:200px;white-space:pre-wrap"></pre>
    <div id="retrieval-rerank-fields" style="margin-top:8px"></div>`;
  panel.append(card);
  // The reranker (experiment retrievalRerank): its model and provider, folded, saved like any declared setting.
  if (r.rerankExperiment) leafFieldsDraw(document.getElementById('retrieval-rerank-fields'), ['retrieval.rerankProvider', 'retrieval.rerankModel'],
    { label: 'Advanced — the reranker (experiment retrievalRerank)', id: 'retrieval-rerank' });
}

async function retrievalSave() {
  const v = id => document.getElementById(id).value.trim();
  try { await apiFetch('/api/retrieval', { method: 'POST', body: { provider: v('retrieval-provider'), model: v('retrieval-model') } }); }
  catch (e) { appAlert(e.message); }
  retrievalCardRender(document.getElementById('sp-harness'));
}

async function retrievalTry() {
  const out = document.getElementById('retrieval-out');
  out.style.display = ''; out.textContent = 'Embedding…';
  try {
    const r = await apiFetch('/api/retrieval/try', { method: 'POST', body: { query: document.getElementById('retrieval-q').value.trim() || 'what this machine is used for' } });
    out.textContent = `${r.ms} ms\n${r.hits.map(h => `${h.score}  ${h.ref}`).join('\n') || 'nothing in memory yet'}`;
  } catch (e) { out.textContent = `✗ ${e.message}`; }
}

function retrievalClear() {
  confirmRemove('the index by meaning', 'Memory and conversations are untouched; finding by meaning falls back to keywords until the index is built again, which spends embedding calls.', async () => {
    try { await apiFetch('/api/retrieval/index', { method: 'DELETE' }); } catch (e) { appAlert(e.message); }
    retrievalCardRender(document.getElementById('sp-harness'));
  }, { verb: 'Empty' });
}

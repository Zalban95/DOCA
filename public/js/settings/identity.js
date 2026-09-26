/* ═══════════════════════════════════════════════════════
   Settings → Harness → Who: persona.md (who the agent is) and human.md (the
   person it works for), modules/harness/identity.js. Plain text, saved as
   markdown in the data folder; the agent reads both every turn and may edit
   them too.
   ═══════════════════════════════════════════════════════ */

async function identityRender(panel) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'identity-card';
  card.innerHTML = `
    <div class="card-title">Who</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:12px">
      Two short pages the agent reads every turn. <strong>Persona</strong> is who it is and how it works with you —
      it may refine it. <strong>Human</strong> is about you, in your words: how you like answers, what you are working on.
      Markdown, in the data folder, so backups carry them; copy text in from another assistant's files if you have them.
    </p>
    <div class="field"><div class="input-label">Persona (persona.md)</div>
      <textarea class="input" id="id-persona" rows="7" spellcheck="true"></textarea></div>
    <div class="field"><div class="input-label">Human (human.md) — about you</div>
      <textarea class="input" id="id-human" rows="7" spellcheck="true"
        placeholder="e.g. I build Android apps and a home lab. Short answers; ask before spending money; I read on my phone a lot."></textarea></div>
    <div class="toolbar"><button class="btn btn-sm btn-blue" onclick="identitySave()">Save</button>
      <span class="status-line" id="id-status"></span></div>`;
  panel.appendChild(card);
  try {
    const d = await apiFetch('/api/harness/identity');
    document.getElementById('id-persona').value = d.persona;
    document.getElementById('id-human').value = d.human;
  } catch (e) { setStatus(document.getElementById('id-status'), `✗ ${e.message}`, 'err'); }
}

async function identitySave() {
  const st = document.getElementById('id-status');
  try {
    await apiFetch('/api/harness/identity', { method: 'POST', body: {
      persona: document.getElementById('id-persona').value, human: document.getElementById('id-human').value } });
    setStatus(st, '✓ Saved — the next turn reads it', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

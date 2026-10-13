/* A story on a speaker (R3h, asked 2026-10-13: "a text mode with multiple emotions select for a story"): a longer text
   where each part carries its own tone — pick a tone and it is put in at the cursor as [calm], [whispers]… — said part
   by part in this person's Quick call voice (cast/speech.js story) and played as one sound. A voice without tones says
   it plainly, its tags dropped. Back closes it (overlayBack). */
function castStoryOpen(id, name) {
  const ov = Object.assign(document.createElement('div'), { className: 'model3d-full hub-links' });
  const tones = _castTones || [];
  ov.innerHTML = `<div class="model3d-bar"><b>A story on ${escHtml(name)}</b><span style="flex:1"></span><button class="btn btn-xs" type="button" data-close>✕</button></div>
    <div class="hub-links-body">
      <p class="desc">${tones.length ? 'Write it, and put a tone before each part: it is said in that tone until the next.' : 'This voice says words only: the story is said plainly. A voice with tones is chosen in Settings → Voice (Quick call).'}</p>
      ${tones.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${tones.map(x => `<button type="button" class="btn btn-xs" data-tone="${escHtml(x)}">${escHtml(x)}</button>`).join('')}</div>` : ''}
      <textarea class="input" rows="10" maxlength="4000" style="width:100%;box-sizing:border-box" placeholder="${tones.length ? '[calm] Once upon a time, in a quiet house… [whispers] Something moved in the dark. [excited] It was the cat!' : 'Once upon a time…'}"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button type="button" class="btn btn-sm btn-teal" data-tell>Tell it</button><span class="status-line"></span></div></div>`;
  const ta = ov.querySelector('textarea'), st = ov.querySelector('.status-line');
  let back = null;
  const close = () => { ov.remove(); back?.(); };
  ov.querySelector('[data-close]').onclick = () => close();
  ov.querySelectorAll('[data-tone]').forEach(b => { b.onclick = () => {
    const tag = `[${b.dataset.tone}] `, at = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, at);
    ta.value = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${tag}${ta.value.slice(at)}`;
    ta.focus();
    const pos = at + tag.length + (before && !/\s$/.test(before) ? 1 : 0);
    ta.setSelectionRange(pos, pos);
  }; });
  ov.querySelector('[data-tell]').onclick = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return setStatus(st, 'Write the story first.', ''); }
    setStatus(st, 'telling…', '');
    try { await apiFetch(`/api/cast/things/${encodeURIComponent(id)}/say`, { method: 'POST', body: { text, story: true } }); setStatus(st, '✓ being told', 'ok'); }
    catch (e) { if (switchAsk(e, () => ov.querySelector('[data-tell]').click())) return setStatus(st, '', ''); setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  document.body.append(ov);
  back = typeof overlayBack === 'function' ? overlayBack(() => { back = null; ov.remove(); }) : null;
  ta.focus();
}

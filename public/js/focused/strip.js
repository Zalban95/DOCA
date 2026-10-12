/* The strip at the bottom of Home: the work going on behind the conversation, in a line — what it is, how far
   ("3 of 4"), and See it. Read from the main chat's background jobs (Always free's state, harness/background.js),
   else the running missions; kept live by the feed's `missions` and `conversation` topics. Nothing behind: no strip. */
function fcStrip(slot, sessionId) {
  if (!slot) return;
  const draw = async () => {
    if (!slot.isConnected) return;
    fcForget(`/api/harness/sessions/${encodeURIComponent(sessionId || '')}/inbox`); fcForget('/api/harness/working');
    const rows = await fcBackground(sessionId);
    const r = rows.find(x => x.running) || rows.find(x => !x.ended);
    if (!r) { slot.replaceChildren(); return; }
    const more = rows.filter(x => x.running && x !== r).length;
    const far = r.total ? `${r.done || 0} of ${r.total}` : '';
    slot.innerHTML = `<button type="button" class="fc-strip" onclick="fcMakeOpen(${jsArg(r.id)})">
      <span class="fc-pt${r.running ? ' run' : ''}" aria-hidden="true"></span><span class="fc-lab fc-strip-lab">Working on</span>
      <span class="fc-bright fc-strip-what">${escHtml(r.title || 'Something you asked for')}${r.text ? `<span class="fc-muted"> — ${escHtml(r.text)}</span>` : ''}</span>
      ${far ? `<span class="fc-mono fc-muted fc-small">${far}</span>` : ''}${more ? `<span class="fc-mono fc-muted fc-small">+${more}</span>` : ''}
      <span class="fc-link fc-strip-see">See it</span></button>`;
  };
  draw();
  if (typeof liveOn === 'function') {
    const again = typeof liveDebounce === 'function' ? liveDebounce(draw, 1500) : draw;
    fcOwn(liveOn('missions', again));
    fcOwn(liveOn('conversation', again));
  }
}

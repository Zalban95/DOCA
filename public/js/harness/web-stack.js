/* A harness that is a web app with its own Compose project — OpenDots (modules/harness/opendots.js): its row says which
   state it is in (not installed, setup required, stopped, answering), Open goes to its own page in a new tab (never
   framed under the panel), and Start/Stop run its own project. */
function webStackActions(h) {
  const arg = jsArg(h.id);
  return `<button class="btn btn-xs btn-green" onclick="webStackOpen(${arg})" title="Its own page, in a new tab">▶ Open</button>
    <button class="btn btn-xs" onclick="webStackRun(${arg}, 'start')" title="Start its Compose project">▶ Start</button>
    <button class="btn btn-xs" onclick="webStackRun(${arg}, 'stop')" title="Stop it (its data stays)">■ Stop</button>`;
}

/** Fill each web harness's state line, after the list is drawn. */
async function webStackRefresh() {
  for (const el of document.querySelectorAll('[data-web-state]')) {
    try {
      const s = await apiFetch(`/api/harness/${el.dataset.webState}/state`);
      el.textContent = s.say;
      el.style.color = s.state === 'ready' ? 'var(--green)' : s.state === 'absent' ? 'var(--muted)' : 'var(--amber)';
      el.dataset.url = s.url;
    } catch (e) { el.textContent = e.message; }
  }
}

function webStackOpen(id) {
  const el = document.querySelector(`[data-web-state="${id}"]`);
  const url = el?.dataset.url;
  if (url) window.open(url, '_blank', 'noopener'); else appAlert('Its address is not known yet.');
}

async function webStackRun(id, action) {
  const out = document.getElementById('harness-install-out');
  showStream(out, '');
  await sseStream(`/api/harness/${id}/stack`, { action }, {
    onStatus: t => appendStream(out, t),
    onError: e => appendStream(out, `\nError: ${e.message}`),
  });
  webStackRefresh();
}

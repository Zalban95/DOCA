/* A computer's own model relay switch (modules/relay/computer.js), on its card in the Computers tab: on, programs inside
   it use this hub's models through the relay — OPENAI_BASE_URL and OPENAI_API_KEY in its environment when it was made
   with it, else ~/work/relay.env written into it — and no provider key goes in. The owner's switch for the relay itself
   is Field → API keys → Model relay (settings/model-relay.js). */
function computersRelayButton(c) {
  const r = c.relay || {};
  const title = r.on ? `Model relay on: programs inside use this hub's models${r.blocked ? ` — but ${r.blocked}` : ''}. Click to switch it off — its token is replaced then, so a copy taken out stops working.`
    : 'Let programs inside use this hub\'s models through the model relay (an OpenAI-compatible address and a token of its own; no provider key goes in).';
  return `<button class="btn btn-xs ${r.on ? 'btn-amber' : ''}" onclick="computersRelay(${jsArg(c.id)}, ${!r.on})" title="${escHtml(title)}">Relay</button>`;
}

async function computersRelay(id, on) {
  try {
    const r = await apiFetch(`/api/computers/${id}/relay`, { method: 'POST', body: { on } });
    if (on && r.blocked) appAlert(`Switched on for this computer, but nothing answers yet: ${r.blocked}.`);
    else if (on && !r.env && !r.file) appAlert('Switched on. It is not running: ~/work/relay.env is written into it when it starts.');
  } catch (e) { appAlert(e.message); }
  computersLoad();
}

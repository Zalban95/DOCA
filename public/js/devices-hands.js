/* ═══════════════════════════════════════════════════════
   Field → API keys: a device's hands — the families it lends (files, shell, screen…) as chips, and the actions on
   it (refresh, reconnect, disconnect). Moved out of devices.js, which had reached its size limit.
   ═══════════════════════════════════════════════════════ */

/* ── Devices as hands (modules/devices-control.js; docs/design/devices-as-hands.md) ── */

const DEV_FAMILY_LABEL = { files: 'Files', shell: 'Shell', processes: 'Processes', screen: 'Screen', input: 'Input',
  apps: 'Apps', device: 'Device', elevated: 'Admin', mcp: 'MCP' };

/** What a device lets the harness do, and the actions on it. */
function devHandsHtml(d) {
  const c = d.control || { grants: {}, revoked: [], history: [], families: Object.keys(DEV_FAMILY_LABEL) };
  const id = jsArg(d.id);
  const chips = c.families.map(f => {
    const granted = c.grants?.[f] === true, revoked = c.revoked?.includes(f);
    const state = revoked ? 'revoked here' : granted ? 'granted' : c.grants?.[f] === false ? 'refused on the device' : 'not reported';
    const cls = revoked ? 'dev-fam revoked' : granted ? 'dev-fam on' : 'dev-fam';
    const act = revoked ? 'restore' : granted ? 'revoke' : 'ask';
    const tip = revoked ? 'Revoked here — click to allow again' : granted ? 'Granted on the device — click to take it back from here' : 'Click to ask the device for it';
    return `<button class="${cls}" title="${escHtml(`${DEV_FAMILY_LABEL[f]}: ${state}. ${tip}`)}" onclick="devControl(${id}, '${act}', '${f}', ${jsArg(d.name || d.id)})">${escHtml(DEV_FAMILY_LABEL[f])}</button>`;
  }).join('');
  const last = c.history?.[0];
  const lastLine = last ? `Last: ${escHtml(last.action)}${last.family ? ` ${escHtml(last.family)}` : ''} ${escHtml(new Date(last.at).toLocaleTimeString())} —
      ${last.ackAt ? (last.ok ? `done${last.detail ? `: ${escHtml(last.detail)}` : ''}` : `refused: ${escHtml(last.detail || '')}`) : 'not answered yet'}` : '';
  return `<div class="dev-hands">
      <div class="dev-fams">${chips}</div>
      <div class="dev-acts">
        <button class="btn btn-xs" onclick="devControl(${id}, 'refresh')" title="The device reports its caps, permissions and state again">⟳ Refresh</button>
        <button class="btn btn-xs" onclick="devControl(${id}, 'reconnect')" title="Drop and reopen its connection">⇄ Reconnect</button>
        <button class="btn btn-xs" onclick="devControl(${id}, 'disconnect')" title="End its sessions and stop its services until it is opened again — it stays paired">⏻ Disconnect</button>
        ${c.disconnected ? '<span class="dev-off">disconnected</span>' : ''}
      </div>
      ${lastLine ? `<div class="input-label" style="text-transform:none;letter-spacing:0">${lastLine}</div>` : ''}
    </div>`;
}

/** What stops when a family is taken back, in words (deep test B: one click on a chip revoked it, unasked). */
const DEV_FAMILY_STOPS = { files: 'reading and changing its files', shell: 'running commands on it', processes: 'seeing and ending its programs',
  screen: 'seeing its screen', input: 'typing and clicking on it', apps: 'opening and listing its apps', device: 'its notifications, clipboard and battery readings',
  elevated: 'anything that needs its administrator rights', mcp: 'the MCP servers it hosts' };

async function devControl(id, action, family, name = 'this device') {
  const go = async () => {
    try {
      await apiFetch(`/api/devices/${encodeURIComponent(id)}/control`, { method: 'POST', body: { action, ...(family ? { family } : {}) } });
      setStatus(document.getElementById(`dev-status-${id}`), `✓ ${action}${family ? ` ${family}` : ''} sent`, 'ok');
      devicesLoad(); devThisDevice();
    } catch (e) { setStatus(document.getElementById(`dev-status-${id}`), `✗ ${e.message}`, 'err'); }
  };
  if (action === 'disconnect') appConfirm('Disconnect this device? Its sessions end and its services stop until it is opened again. It stays paired.', go);
  else if (action === 'revoke' && family) appConfirm(`Take ${DEV_FAMILY_LABEL[family] || family} back from ${name}?\n\nThe agents stop ${DEV_FAMILY_STOPS[family] || 'using it'}: its MCP server no longer offers those tools, a conversation using them included. Pressing the chip again gives it back.`, go);
  else go();
}

/* ═══════════════════════════════════════════════════════
   Harness tab: approval requests and the always-allowed list.
   ═══════════════════════════════════════════════════════ */

/**
 * Draw, or settle, one approval request.
 *
 * Three states arrive on the same event: `asked` puts the card up, `answered`
 * settles it (which is how a card answered in the floating chat stops offering
 * a choice here), and `refused` is a mission that had nobody to ask.
 */
function _hcApproval(evt, box, scroll) {
  // Its three states are decided once, for every chat (agent-ui/event-sink.js).
  agentApprovalEvent(evt, box, { note: text => _hcAppend('error', text, 'approval'), onSettle: () => _hcLoadApproval(), scroll });
}

/** The Auto / Manual pill and the standing allowlist behind it. */
async function _hcLoadApproval() {
  const slot = document.getElementById('hc-approval');
  if (!slot) return;
  try {
    const a = await apiFetch('/api/harness/approval');
    _hcApprovalState = a;
    if (!slot.firstChild) slot.appendChild(approvalModeEl(s => { _hcApprovalState = s; _hcLoadApproval(); }));
    slot.firstChild.render(a.mode);
    const list = document.getElementById('hc-approval-list');
    if (list) _hcApprovalFill(list, a);
  } catch { /* the pill simply does not appear */ }
}

let _hcApprovalState = null;

function _hcApprovalFill(list, a) {
  list.innerHTML = '';

  // Unattended: the owner's switch for a test bench (modules/harness/approval.js).
  const bench = document.createElement('div');
  bench.className = 'approval-unattended';
  const on = a.mode === 'unattended';
  bench.innerHTML = `<div class="hc-side-head">Unattended mode${on ? ' — on' : ''}</div>
    <p style="font-size:11px;color:${on ? 'var(--red)' : 'var(--muted)'};margin:0 0 6px">
      ${on ? 'Tools run, and the agent\'s own settings changes and installs apply the moment it makes them. Each one is in the audit log.'
           : 'Off. When on, nothing is asked: tools run, and the agent\'s own settings changes and installs apply without a click. For a machine you are testing on.'}</p>`;
  const toggle = document.createElement('button');
  toggle.className = `btn btn-xs ${on ? '' : 'btn-red'}`;
  toggle.textContent = on ? 'Turn it off' : 'Turn on unattended mode…';
  toggle.onclick = () => {
    const set = async body => {
      try { await apiFetch('/api/harness/approval', { method: 'POST', body }); _hcLoadApproval(); }
      catch (e) { appAlert(e.message); }
    };
    if (on) return set({ mode: 'auto' });
    appConfirm('Turn on unattended mode?\n\nNothing will be asked any more: every tool runs, and the agent applies its own '
      + 'settings changes and installs without your click. Each is logged. Meant for a machine you are testing on.',
      () => set({ mode: 'unattended', confirm: 'unattended' }));
  };
  bench.appendChild(toggle);
  list.appendChild(bench);

  // After outside text (a web page, another machine's tool result), the next action asks again, once.
  const re = document.createElement('label');
  re.className = 'approval-recheck';
  re.innerHTML = `<input type="checkbox" ${a.recheckOutside !== false ? 'checked' : ''}>
    <span><b>Ask again after outside text</b> — once a web page or another machine's answer has entered a turn, the
    first command after it that changes something asks you, even if it is allowed. Your devices are told too.</span>`;
  re.querySelector('input').onchange = async ev => {
    try { await apiFetch('/api/harness/approval', { method: 'POST', body: { recheckOutside: ev.target.checked } }); _hcLoadApproval(); }
    catch (e) { appAlert(e.message); }
  };
  list.appendChild(re);

  // A mission's use of a machine is asked of its person (modules/harness/mission-asks.js): how long it is pressed on
  // their devices, and what no answer by then becomes — held open (the mission waits) or a no.
  const wait = document.createElement('label');
  wait.className = 'approval-recheck';
  const hold = a.missionAskTimeout !== 'deny';
  wait.innerHTML = `<span><b>A mission's machine question waits</b> <input class="input" type="number" min="10" max="900" step="10" style="width:5em"
    value="${Number(a.missionAskSec) || 300}"> seconds, then <select class="input" style="width:auto">
      <option value="hold" ${hold ? 'selected' : ''}>stays open</option><option value="deny" ${hold ? '' : 'selected'}>is a no</option></select>
    — a specialist asking to use the VNC screen or computer it was lent is asked of its person, on their devices and open pages.
    ${hold ? 'Unanswered, it leaves their devices but stays here, and the mission waits (no steps, no tokens) until someone answers or stops it.'
      : 'Unanswered, it is denied and the mission reports why.'}</span>`;
  const post = async body => {
    try { await apiFetch('/api/harness/approval', { method: 'POST', body }); _hcLoadApproval(); }
    catch (e) { appAlert(e.message); }
  };
  wait.querySelector('input').onchange = ev => post({ missionAskSec: Number(ev.target.value) });
  wait.querySelector('select').onchange = ev => post({ missionAskTimeout: ev.target.value });
  list.appendChild(wait);

  // Questions raised elsewhere — a turn a phone started, or one in a chat that
  // is not open. Without this they block until they time out with nothing on
  // screen anywhere, because the card only ever appears in the transcript that
  // was being watched when it was asked.
  if (a.pending?.length) {
    const head = document.createElement('div');
    head.className = 'hc-side-head';
    head.textContent = `Waiting for an answer (${a.pending.length})`;
    list.appendChild(head);
    for (const p of a.pending) list.appendChild(approvalCardEl(p, () => _hcLoadApproval()));
  }

  const head = document.createElement('div');
  head.className = 'hc-side-head';
  head.textContent = 'Allowed without asking';
  list.appendChild(head);

  if (!a.always.length) {
    const none = document.createElement('div');
    none.className = 'placeholder';
    none.textContent = 'Nothing yet — every tool call that does something is asked about.';
    list.appendChild(none);
    return;
  }
  for (const k of a.always) {
    const row = document.createElement('div');
    row.className = 'approval-key';
    const name = document.createElement('span');
    name.className = 'flex1';
    name.textContent = k;
    const drop = document.createElement('button');
    drop.className = 'btn btn-xs btn-red';
    drop.textContent = '✕';
    drop.title = 'Ask again next time';
    drop.addEventListener('click', () => hcApprovalForget(k));
    row.append(name, drop);
    list.appendChild(row);
  }
}

function hcApprovalOpen() {
  const overlay = document.getElementById('hc-approval-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _hcLoadApproval();
}

function hcApprovalClose() {
  const overlay = document.getElementById('hc-approval-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function hcApprovalForget(key) {
  try {
    await apiFetch(`/api/harness/approval/always/${encodeURIComponent(key)}`, { method: 'DELETE' });
    _hcLoadApproval();
  } catch (e) { appAlert(e.message); }
}

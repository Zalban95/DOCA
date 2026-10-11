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
  // Someone without host: the mode and its lists are an admin's; what is theirs is every question waiting for them —
  // their level's card, their own budget's, a mission's machine (deep test A: a member's were listed nowhere).
  if (!Array.isArray(a.always)) return _hcApprovalMine(list, a);

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
  re.innerHTML = `<input type="checkbox" data-default="true" data-label="Ask again after outside text" ${a.recheckOutside !== false ? 'checked' : ''}>
    <span><b>Ask again after outside text</b>${infoBtn('In Manual mode: once a web page or another machine\'s answer has entered a turn, the first command after it that changes something asks you, even if it is allowed — such text can carry instructions you never gave. Your devices are asked too. Auto never asks. On by default.')}</span>`;
  re.querySelector('input').onchange = async ev => {
    try { await apiFetch('/api/harness/approval', { method: 'POST', body: { recheckOutside: ev.target.checked } }); _hcLoadApproval(); }
    catch (e) { appAlert(e.message); }
  };
  list.appendChild(re);

  // What Manual asks (modules/harness/approval-matters.js): everything that does something, or only what matters. A
  // safety switch like the mode: the hub asks for the password (auth/guarded.js) and the fetch wrapper types it.
  const asks = document.createElement('label');
  asks.className = 'approval-recheck';
  const matters = a.manualAsks !== 'everything';
  asks.innerHTML = `<span><b>Manual asks</b> <select class="input" style="width:auto" data-default="what-matters" data-label="Manual asks">
      <option value="what-matters" ${matters ? 'selected' : ''}>what matters</option><option value="everything" ${matters ? '' : 'selected'}>everything</option></select>${infoBtn(
      'Used when approvals are Manual. "What matters" (the default) asks only for what cannot be undone or leaves this machine: sending data out, posting, mail, pushing, paying, deleting outside a project, a command it cannot read, a tool on another machine; reads and changes with a way back run without asking. "Everything" asks for every tool call that does something. Changing it asks for your password.')}</span>`;
  asks.querySelector('select').onchange = async ev => {
    try { await apiFetch('/api/harness/approval', { method: 'POST', body: { manualAsks: ev.target.value } }); }
    catch (e) { appAlert(e.message); }
    _hcLoadApproval();
  };
  list.appendChild(asks);

  // A mission's use of a machine is asked of its person (modules/harness/mission-asks.js): how long it is pressed on
  // their devices, and what no answer by then becomes — held open (the mission waits) or a no.
  const wait = document.createElement('label');
  wait.className = 'approval-recheck';
  const hold = a.missionAskTimeout !== 'deny';
  wait.innerHTML = `<span><b>A mission's machine question waits</b> <input class="input" type="number" min="10" max="900" step="10" style="width:5em"
    data-default="300" data-label="Seconds a mission's question waits" value="${Number(a.missionAskSec) || 300}"> seconds, then <select class="input" style="width:auto" data-default="hold" data-label="Then">
      <option value="hold" ${hold ? 'selected' : ''}>stays open</option><option value="deny" ${hold ? '' : 'selected'}>is a no</option></select>${infoBtn(
      'A specialist asking to use the screen or computer it was lent asks its person, on their devices and open pages. After these seconds (300 by default, 10–900) an unanswered question either stays open here while the mission waits, using no steps or tokens (the default), or counts as a no and the mission reports why.')}</span>`;
  const post = async body => {
    try { await apiFetch('/api/harness/approval', { method: 'POST', body }); _hcLoadApproval(); }
    catch (e) { appAlert(e.message); }
  };
  wait.querySelector('input').onchange = ev => post({ missionAskSec: Number(ev.target.value) });
  wait.querySelector('select').onchange = ev => post({ missionAskTimeout: ev.target.value });
  list.appendChild(wait);
  advancedFold([re, asks, wait], { id: 'hc-approval-more', label: 'Advanced — when it asks again' });

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

/** A person's own waiting questions, for someone without host. */
function _hcApprovalMine(list, a) {
  const head = document.createElement('div');
  head.className = 'hc-side-head';
  head.textContent = a.pending?.length ? `Waiting for your answer (${a.pending.length})` : 'Nothing is waiting for your answer';
  list.appendChild(head);
  for (const p of a.pending || []) list.appendChild(approvalCardEl(p, () => _hcLoadApproval()));
  const note = document.createElement('p');
  note.style.cssText = 'font-size:11px;color:var(--muted);margin:8px 0 0';
  note.textContent = 'Whether the agents ask first, and what runs without asking, is an admin\'s to set. Your level may ask before every call.';
  list.appendChild(note);
}

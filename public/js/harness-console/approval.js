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
  if (!box) return;
  box.querySelector('.placeholder')?.remove();
  // Out of the working fold and into the transcript: a collapsing run would
  // hide the question the turn is blocked on.
  agentWorkingGiveBack(box);

  if (evt.state === 'refused') {
    _hcAppend('error', `Not run — ${evt.tool} needs approval and a mission has nobody to ask.`, 'approval');
    scroll?.();
    return;
  }
  if (evt.state === 'answered') {
    box.querySelector(`[data-approval-id="${CSS.escape(evt.id)}"]`)?.settleFrom?.(evt.decision);
    // Answered elsewhere — the watch that started the turn, the floating chat,
    // another tab. The popup must not keep asking something already decided.
    approvalPopupClose(evt.id);
    scroll?.();
    return;
  }
  const card = approvalCardEl(evt, () => _hcLoadApproval());
  box.appendChild(card);
  // The card is the record; the popup is what gets answered. A blocked turn
  // whose question is three screens up reads as a hang.
  approvalPopup(evt, d => { card.settleFrom?.(d); _hcLoadApproval(); });
  scroll?.();
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

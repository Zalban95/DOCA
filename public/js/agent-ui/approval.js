/* ═══════════════════════════════════════════════════════
   Manual approval: the card, the popup, and the Auto / Manual pill.
   Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

/* ── Manual approval ───────────────────────────────────
   One card, rendered the same in the floating chat and the harness console.
   The turn is blocked on the other side of it, so this is the whole of what
   the user has to go on: what would run, and what saying yes would mean. */

/**
 * The card a blocked tool call puts in the transcript.
 *
 * Buttons are built from the request, not assumed: a call that cannot be
 * reduced to a type (a command assembled at run time) gets no "always" at all
 * rather than one that would remember the wrong thing.
 *
 * @param {object} evt    the `approval` event: {id, tool, keys, summary}
 * @param {Function} done called with the decision once the server has it
 */
function approvalCardEl(evt, done) {
  const el = document.createElement('div');
  el.className = 'approval-card';
  el.dataset.approvalId = evt.id;

  const head = document.createElement('div');
  head.className = 'approval-head';
  head.textContent = `Allow ${evt.tool}?`;
  el.appendChild(head);

  if (evt.summary) {
    // textContent, never innerHTML: this string is a command the model wrote.
    const body = document.createElement('pre');
    body.className = 'approval-body';
    body.textContent = evt.summary;
    el.appendChild(body);
  }

  const row = document.createElement('div');
  row.className = 'approval-actions';

  const choices = [
    { decision: 'once', label: 'Allow once', cls: 'btn-green' },
    ...(evt.keys?.length
      ? [{ decision: 'always', label: `Always allow ${evt.keys.join(', ')}`, cls: '' }]
      : []),
    ...(evt.keys?.length && !(evt.keys.length === 1 && evt.keys[0] === evt.tool)
      ? [{ decision: 'always_tool', label: `Always allow all ${evt.tool}`, cls: '' }]
      : []),
    { decision: 'deny', label: 'Deny', cls: 'btn-red' },
  ];

  const settle = text => {
    el.classList.add('settled');
    el.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'approval-settled';
    line.textContent = text;
    el.appendChild(line);
  };

  for (const c of choices) {
    const b = document.createElement('button');
    b.className = `btn btn-xs ${c.cls}`;
    b.textContent = c.label;
    b.addEventListener('click', async () => {
      row.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try {
        await apiFetch(`/api/harness/approvals/${encodeURIComponent(evt.id)}`,
          { method: 'POST', body: { decision: c.decision } });
        settle(`${evt.tool} — ${c.label.toLowerCase()}`);
        done?.(c.decision);
      } catch (e) {
        // The usual cause is that the question withdrew itself: the turn was
        // stopped, or five minutes passed. Saying so beats a red error.
        settle(`${evt.tool} — ${e.message}`);
        done?.(null);
      }
    });
    row.appendChild(b);
  }
  el.appendChild(row);

  // Answered somewhere else — the other chat, another tab, the watch that
  // started the turn. Both are looking at one turn, so the card has to stop
  // offering a choice that is already made. A missing decision means the
  // question withdrew itself, which is a sentence rather than the word "null".
  el.settleFrom = decision => settle(`${evt.tool} — ${decision || 'no longer waiting'}`);
  return el;
}

/**
 * The same question, in front of the user rather than in the scroll.
 *
 * The transcript card stays — it is the record of what was asked and what was
 * answered — but a turn is blocked behind this, and a blocked turn whose
 * question is three screens up in a chat nobody is scrolled to reads as a
 * hang. One overlay at a time: a turn asks one question at a time, and a stack
 * of modals is a worse way to say "two things are waiting" than the list in
 * Harness → Approvals.
 *
 * Deliberately not dismissible by clicking away or by Escape. Every button
 * here is a decision, "denied" included, and a modal that vanishes on a stray
 * click would answer for the user by doing nothing until the timeout.
 */
function approvalPopup(evt, done) {
  if (document.getElementById('approval-overlay')) return null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay approval-overlay';
  overlay.id = 'approval-overlay';
  overlay.style.display = 'flex';

  const modal = document.createElement('div');
  modal.className = 'modal approval-modal';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'The agent is asking to do something';
  modal.appendChild(title);

  const card = approvalCardEl(evt, decision => {
    overlay.remove();
    done?.(decision);
  });
  modal.appendChild(card);

  const note = document.createElement('p');
  note.className = 'approval-note';
  note.textContent = evt.keys?.length
    ? 'Always allow remembers the command type, not this exact command. Take it back in Harness → Approvals.'
    : 'This command builds itself as it runs, so there is no type to remember — it can only be allowed this once.';
  modal.appendChild(note);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // The safe button gets focus, so a stray Enter denies rather than approves.
  modal.querySelector('.approval-actions button:last-child')?.focus();
  return overlay;
}

/** Take the popup down when the answer came from somewhere else. */
function approvalPopupClose(id) {
  const overlay = document.getElementById('approval-overlay');
  if (overlay && (!id || overlay.querySelector(`[data-approval-id="${CSS.escape(id)}"]`))) overlay.remove();
}

/** The Auto / Manual pill both chats put in their header. */
function approvalModeEl(onChange) {
  const el = document.createElement('button');
  el.className = 'btn btn-xs approval-mode';
  el.type = 'button';
  el.title = 'Manual asks before each tool call that does something, and can remember your answer by '
    + 'command type. Auto runs everything the agent asks for.';
  el.render = mode => {
    const manual = mode === 'manual';
    el.textContent = manual ? '🔒 Manual' : '⚡ Auto';
    el.classList.toggle('manual', manual);
    el.dataset.mode = manual ? 'manual' : 'auto';
  };
  el.addEventListener('click', async () => {
    const next = el.dataset.mode === 'manual' ? 'auto' : 'manual';
    try {
      const r = await apiFetch('/api/harness/approval', { method: 'POST', body: { mode: next } });
      el.render(r.mode);
      onChange?.(r);
    } catch (e) { appAlert(e.message); }
  });
  el.render('auto');
  return el;
}

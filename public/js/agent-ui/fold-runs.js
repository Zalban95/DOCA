/* ═══════════════════════════════════════════════════════
   Collapsing a finished run of folds into one row, keeping the answer out.
   Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

/**
 * The working of a finished run becomes one row, and the answer stays out of it.
 *
 * Closing the folds is not enough once a turn has run fifteen tools: fifteen
 * one-line rows still push the answer off the screen, and the answer is the
 * thing being waited for. So the whole run collapses into a single row that says
 * what it was — the same shape a live block closes into, so a reloaded
 * transcript and a turn you watched happen look the same.
 *
 * Grouping does not do this: `agentFoldMount` folds a run of the *same* kind,
 * and a turn alternates Command with Result, so the commonest long run is
 * exactly the one that never grouped.
 *
 * It happens when the turn ends, never while it streams: a row that vanished
 * upward as it arrived would take the eye with it. The "…" opens everything it
 * hides in one click, each row inside still opens on its own, and a run the
 * user has already opened is left alone.
 *
 * @param {HTMLElement} container - a transcript (#hc-messages, #chat-messages)
 */
function collapseFoldRuns(container) {
  if (!container) return;
  const isRow = el => el.classList.contains('agent-fold') || el.classList.contains('agent-fold-group');

  // A bubble the streamer opened and never filled is not content, and it was
  // quietly defeating the whole of this: `createThinkStream` makes a text
  // bubble per text segment, so a live turn interleaves empty bubbles with its
  // rows, every run came out one row long, and nothing ever collapsed. It only
  // worked on a reloaded transcript, which has no empty bubbles — which is
  // exactly where it was tested. They are dropped here rather than skipped,
  // because an empty bubble is not worth a row of the transcript either.
  for (const el of [...container.children]) {
    if (isRow(el) || el.classList.contains('agent-working')) continue;
    if (!el.textContent.trim() && !el.querySelector('img, video, audio, svg, canvas')) el.remove();
  }

  // What a run is made of, and it is not only folds. A model that narrates
  // ("Checking the next one…") puts a text bubble between every step, so runs
  // of folds alone came out three rows long and never reached the threshold —
  // the harness console looked fixed and the floating chat did not, purely
  // because one conversation happened to narrate and the other did not.
  // The working of a turn is everything the agent did *and* said on the way to
  // its answer, so commentary collapses with the steps it belongs to.
  const isWorking = el => isRow(el) || (isBubble(el) && !isUser(el));

  // Something the turn *showed* rather than something it did or said. A picture
  // is drawn mid-turn, between a tool call and its result, so it belongs to the
  // run without being part of its account: it keeps its own visible row and is
  // neither swallowed by the summary nor allowed to end it. See the walk below.
  const isOutput = el => el.classList.contains('agent-image');

  let run = [];
  const flush = last => {
    // The answer is the end of the turn, not part of its working: a run that
    // reaches the end of a turn gives back its trailing text bubbles, so the
    // thing the user was waiting for is never what gets hidden.
    let rows = run;
    if (last) while (rows.length && isBubble(rows[rows.length - 1])) rows = rows.slice(0, -1);
    // One line per finished turn, not a tail of three: the same summary a
    // live block closes into, so a reloaded transcript and a turn you watched
    // happen look the same.
    if (rows.some(isRow)) _foldRunCollapse(rows);
    run = [];
  };
  const children = [...container.children];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // A run that already has its "…" is left as it is, opened or not: this runs
    // again after every later turn, and re-collapsing would undo a click.
    if (child.classList.contains('agent-working')) { run = []; continue; }
    if (isWorking(child)) { run.push(child); continue; }
    // Shown, not summarised, and not a boundary either. Treating a picture as
    // the end of a turn split one turn into two summaries — "1 command" then
    // "1 step" — because it arrives in the middle of one. The run keeps going
    // across it, so the block lands at the run's first row and the picture falls
    // after the collapsed record, which is where the live path already puts it.
    //
    // The run keeps going, but the sentence the picture was shown under does
    // not come with it: a picture with its sentence folded away has nothing left
    // to sit beside, so it drifts down to the end of the turn and stacks against
    // every other picture there. The sentence is the *last* bubble in the run
    // rather than the trailing one, because the call that showed the picture was
    // drawn after the sentence and before the picture.
    if (isOutput(child)) {
      const at = _lastBubble(run);
      if (at >= 0) run = run.slice(0, at).concat(run.slice(at + 1));
      continue;
    }
    flush(true);                       // a user message: the turn ended here
  }
  flush(true);
}

/**
 * A message bubble in either transcript, whoever wrote it.
 *
 * Deliberately not `.agent-image`. `flush` gives back the run's trailing text
 * bubbles so the answer is never inside the summary, and a picture is not text
 * — but that also means a picture as the run's *last* row would leave the answer
 * behind it inside the block. It cannot happen today: a picture is only ever
 * drawn between a call and its result, and an answer ends the turn. Noted here
 * for whoever makes it possible, because the failure would look like a lost
 * reply rather than a fold that took one row too many.
 */
function isBubble(el) {
  return el.classList.contains('hc-msg') || el.classList.contains('chat-msg');
}

/** The user's own message, which is where one turn ends and the next begins. */
function isUser(el) {
  return el.classList.contains('hc-user')
    || (el.classList.contains('chat-msg') && el.classList.contains('user'));
}

/**
 * Wrap a finished turn's working in the same block a live turn closes into.
 *
 * Used on a reloaded transcript, which has no timings to report - so the
 * summary is what can be counted rather than what was measured, and the shape
 * a reader clicks is identical either way.
 */
function _foldRunCollapse(rows) {
  const container = rows[0].parentElement;
  const block = document.createElement('div');
  block.className = 'agent-working done';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-fold-head agent-working-head';
  head.setAttribute('aria-expanded', 'false');
  head.title = 'Show every step of this turn';

  const label = document.createElement('span');
  label.className = 'agent-fold-label';
  label.textContent = _workingSummary(rows, _workingSeconds(rows));

  const chevron = document.createElement('span');
  chevron.className = 'agent-fold-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';

  head.append(label, chevron);
  head.addEventListener('click', () => {
    const open = !block.classList.contains('open');
    block.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const items = document.createElement('div');
  items.className = 'agent-working-items';

  rows[0].replaceWith(block);
  for (const row of rows) items.appendChild(row);
  block.append(head, items);
  return block;
}

/* ═══════════════════════════════════════════════════════
   The working block of one turn: one line while it runs, one line when done.
   Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

/**
 * What a finished turn's one line says.
 *
 * `seconds` is measured when the block was watched live and read from the rows'
 * own timestamps when it was rebuilt from a transcript; when neither is
 * available it is left out rather than guessed.
 */
function _workingSummary(rows, seconds) {
  const folds = rows.flatMap(r => r.classList.contains('agent-fold') ? [r] : [...r.querySelectorAll('.agent-fold')]);
  const commands = folds.filter(r => r.classList.contains('agent-fold-tool-call')).length;
  const thinking = folds.filter(r => r.classList.contains('agent-fold-thinking')).length;
  const took = !seconds ? ''
    : seconds < 60 ? ` for ${seconds}s`
    : ` for ${Math.round(seconds / 60)}m`;
  return [
    thinking ? `Thought${took}` : (took ? `Worked${took.slice(4)}` : ''),
    commands ? `${commands} command${commands === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || `${rows.length} step${rows.length === 1 ? '' : 's'}`;
}

/** The span a set of rows covers, from the timestamps a transcript carries. */
function _workingSeconds(rows) {
  const times = rows.map(r => Date.parse(r.dataset.at || '')).filter(Number.isFinite);
  if (times.length < 2) return 0;
  return Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
}

/**
 * The working of one turn: one line while it happens, one line when it is done.
 *
 * A turn used to write every step into the transcript as it arrived — thinking,
 * command, result, commentary, thinking, command — so watching the agent work
 * meant watching the answer being pushed off the screen by the account of how it
 * was reached. Collapsing it afterwards (the old "… N earlier steps") fixed the
 * finished transcript and left the live one exactly as it was.
 *
 * So the working of a turn is one element. While the turn runs it shows its last
 * row and nothing else: whatever the agent is doing *now*, which is the only row
 * anybody reads at that moment. Each row is still a fold, so clicking the
 * thinking row opens the thinking and it keeps streaming into a box that scrolls.
 * When the turn ends the whole block becomes one line — "Thought for 12s · 6
 * commands" — which opens to the whole working, in order.
 *
 * The answer is not working: trailing message bubbles are lifted back out of the
 * block when it closes, so the thing that was being waited for is never inside
 * the summary.
 *
 * @param {HTMLElement} container - a transcript (#hc-messages, #chat-messages)
 * @returns {HTMLElement} the block, also remembered on the container
 */
function agentWorkingOpen(container) {
  if (!container) return null;
  if (container._working && container.contains(container._working)) return container._working;

  const block = document.createElement('div');
  block.className = 'agent-working live';
  block.dataset.startedAt = String(Date.now());

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-fold-head agent-working-head';
  head.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'agent-fold-label';
  label.textContent = 'Working';

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

  block.append(head, items);
  container.appendChild(block);
  container._working = block;
  return block;
}

/** Where a row of this turn goes: inside the open block, or the transcript. */
function agentWorkingMount(container, node) {
  const block = container && container._working;
  if (block && container.contains(block)) {
    block.querySelector('.agent-working-items').appendChild(node);
    return;
  }
  container.appendChild(node);
}

/** Index of the last message bubble in a list of rows, or -1 if there is none. */
function _lastBubble(rows) {
  for (let i = rows.length - 1; i >= 0; i--) if (isBubble(rows[i])) return i;
  return -1;
}

/**
 * Lift a message back out of the open block, into the transcript.
 *
 * The block is the account of how the turn reached its answer, and the account
 * is what nobody asked to read — but two things in a turn are not account. The
 * answer is one. The sentence that introduced a picture is the other: a picture
 * is shown under whatever was said about it, and a picture whose sentence has
 * been folded away has lost the place it was shown in. It falls to the end of
 * the turn and stacks against every other picture there, so one shown first
 * thing reads as though it came last.
 *
 * `trailing` takes the run of bubbles at the end, which is the answer when the
 * block closes. Otherwise it takes the last bubble wherever it sits, which is
 * where a picture's own sentence is: the call that showed the picture is drawn
 * after the sentence and before the picture, so the sentence is not trailing.
 *
 * @param {HTMLElement} container - a transcript with an open block
 * @param {{trailing?: boolean, block?: HTMLElement}} [opts]
 */
function agentWorkingGiveBack(container, { trailing = false, block = container && container._working } = {}) {
  if (!block || !container.contains(block)) return;
  const rows = [...block.querySelector('.agent-working-items').children];
  if (trailing) {
    for (let i = rows.length - 1; i >= 0 && isBubble(rows[i]); i--) container.appendChild(rows[i]);
    return;
  }
  const at = _lastBubble(rows);
  if (at >= 0) container.appendChild(rows[at]);
}

/**
 * Close the block: give the answer back, and say what the working was.
 *
 * Counted from the rows themselves rather than from a tally kept alongside,
 * because the rows are what a reader will open to check the count against.
 */
function agentWorkingClose(container) {
  const block = container && container._working;
  container._working = null;
  if (!block || !container.contains(block)) return;

  // The answer, and anything else the agent said last, belongs in the
  // transcript rather than behind a summary. The same walk the picture uses,
  // from the other end — one implementation, because a picture given back in
  // the live chat and the same turn given back on a reload must agree.
  agentWorkingGiveBack(container, { trailing: true, block });

  const items = block.querySelector('.agent-working-items');
  const rows = [...items.children];
  if (!rows.length) { block.remove(); return; }

  const seconds = Math.max(1, Math.round((Date.now() - Number(block.dataset.startedAt || Date.now())) / 1000));
  const said = _workingSummary(rows, seconds);

  block.classList.remove('live');
  block.classList.add('done');
  block.querySelector('.agent-fold-label').textContent = said;
  block.querySelector('.agent-working-head').title = 'Show every step of this turn';
}

/**
 * Fold away everything a turn left standing, once the turn is over.
 *
 * A run of six commands should end as three short rows, not as three rows plus
 * whichever one happened to be streaming when the turn ended. Rows the user
 * opened or closed themselves are left exactly as they left them — this tidies
 * up after the turn, it does not overrule a click.
 *
 * @param {HTMLElement} container - a transcript (#hc-messages, #chat-messages)
 */
function closeFolds(container) {
  if (!container) return;
  for (const fold of container.querySelectorAll('.agent-fold')) {
    if (fold.dataset.userOpened) continue;
    fold.classList.remove('active');
    _foldSetOpen(fold, false);
  }
  for (const group of container.querySelectorAll('.agent-fold-group')) {
    if (group.dataset.userOpened) continue;
    _foldGroupOpen(group, false);
    delete group.dataset.autoOpened;
  }
  collapseFoldRuns(container);
}

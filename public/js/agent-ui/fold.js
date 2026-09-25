/* ═══════════════════════════════════════════════════════
   Agent transcript folds: one collapsible Thinking / Command / Result row,
   and grouping a run of the same kind.
   Shared by the floating chat (chat.js) and the harness console (harness.js).
   ═══════════════════════════════════════════════════════ */

/** Open or shut one fold, keeping its header's aria-expanded honest. */
function _foldSetOpen(el, on) {
  el.classList.toggle('open', !!on);
  el.querySelector('.agent-fold-head')?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/**
 * Collapsible Thinking / Command / Result block for the harness console and
 * the floating chat. Tap the header to expand; `.active` drives the animated
 * dots so it is obvious the model is still working.
 *
 * @param {{
 *   kind: 'thinking'|'tool-call'|'tool-result',
 *   label: string,
 *   body?: string,
 *   active?: boolean,
 *   open?: boolean,
 * }} opts
 * @returns {{
 *   el: HTMLElement,
 *   body: HTMLElement,
 *   setActive: (on: boolean) => void,
 *   setOpen: (on: boolean) => void,
 *   setLabel: (t: string) => void,
 *   append: (t: string) => void,
 *   setBody: (t: string) => void,
 *   isEmpty: () => boolean,
 *   remove: () => void,
 * }}
 */
function agentFold(opts) {
  const el = document.createElement('div');
  el.className = `agent-fold agent-fold-${opts.kind}`;
  // agentFoldMount() groups a run of one kind and only ever sees the element,
  // never these opts, so the kind has to travel on the node.
  el.dataset.foldKind = opts.kind;
  if (opts.active) el.classList.add('active');
  // A fold that is still running is open, because the thing it is reporting is
  // happening now and watching it is the reason it is on screen at all. The
  // body used to stay shut until the run was over, which hid streaming
  // thinking entirely behind a click. setActive(false) shuts it again.
  if (opts.active || opts.open) el.classList.add('open');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-fold-head';
  head.setAttribute('aria-expanded', opts.open ? 'true' : 'false');

  const label = document.createElement('span');
  label.className = 'agent-fold-label';
  label.textContent = opts.label;

  // The first line of the content, on the head. A row that says only "THINKING"
  // is legible without being informative: in a run of six the user is looking
  // for the one that mentioned the port, and reading them one by one to find it
  // is what the fold was supposed to save.
  const preview = document.createElement('span');
  preview.className = 'agent-fold-preview';
  const setPreview = () => { preview.textContent = foldPreview(body.textContent); };

  const dots = document.createElement('span');
  dots.className = 'agent-fold-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.textContent = '...';

  const chevron = document.createElement('span');
  chevron.className = 'agent-fold-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';

  const body = document.createElement('pre');
  body.className = 'agent-fold-body';
  body.textContent = opts.body || '';

  head.append(label, preview, dots, chevron);
  setPreview();

  head.addEventListener('click', () => {
    const open = el.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    // A row the user opened by hand is theirs: nothing automatic closes it.
    if (open) el.dataset.userOpened = '1'; else delete el.dataset.userOpened;
    // Opened onto the newest lines, not the oldest: this is opened mid-thought
    // to watch it arrive, and a box that starts at the top shows the beginning
    // of a paragraph that has since moved on — and then never follows, because
    // `append` only follows a reader who is already at the end.
    if (open) body.scrollTop = body.scrollHeight;
  });

  el.append(head, body);

  return {
    el, body,
    setActive(on) {
      el.classList.toggle('active', !!on);
      if (on) return;
      // The run this fold was reporting is over, so it folds away again — the
      // whole point of the row is that a finished turn is a short transcript.
      // A fold the user opened themselves is the one thing this must not undo.
      if (!el.dataset.userOpened) _foldSetOpen(el, false);
      const group = el.closest('.agent-fold-group');
      if (group?.dataset.autoOpened && !group.dataset.userOpened && !el.dataset.userOpened) {
        _foldGroupOpen(group, false);
        delete group.dataset.autoOpened;
      }
    },
    setOpen(on) { _foldSetOpen(el, on); },
    setLabel(t) { label.textContent = t; },
    append(t) {
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 12;
      body.textContent += t; setPreview();
      // Follow the thinking as it arrives, unless the reader has scrolled up
      // into it - which is the one time the newest line is not the wanted one.
      if (atEnd) body.scrollTop = body.scrollHeight;
    },
    setBody(t) { body.textContent = t; setPreview(); },
    isEmpty() { return !body.textContent.trim(); },
    remove() {
      const items = el.parentElement;
      el.remove();
      // An empty "Thinking" indicator drops itself at the end of every turn.
      // Inside a group that would leave the count a lie, or a group row around
      // a single fold, so the group is re-read after the node is gone.
      if (items && items.classList.contains('agent-fold-group-items')) _foldGroupSync(items.parentElement);
    },
  };
}

/**
 * The one line a collapsed head shows of its content.
 *
 * Whitespace is collapsed rather than kept: the first line of a tool call is
 * `{` often as not, and pretty-printed JSON on one line is more use than the
 * brace it starts with.
 */
function foldPreview(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/**
 * Head label for a run of folds of one kind. The individual heads name the tool
 * ("Command · shell"), so the group head says only what kind of run it is.
 */
const FOLD_GROUP_LABELS = {
  'thinking':    'Thinking',
  'tool-call':   'Commands',
  'tool-result': 'Results',
};

/**
 * Append a fold to a transcript, folding a run of the same kind into one row
 * ("Thinking × 4") that opens to reveal the individual folds, each still
 * openable on its own.
 *
 * Takes the element and not the handle because the streaming state machine
 * mounts `fold.el` through a caller-supplied `mount()` and keeps the handle to
 * itself — and because a non-fold node (a message bubble) must be able to pass
 * through here and break the run.
 *
 * @param {HTMLElement} container - the transcript (#hc-messages, #chat-messages)
 * @param {HTMLElement} node - an element from agentFold()
 */
function agentFoldMount(container, node) {
  // While a turn is running its rows live in the working block, which shows one
  // of them at a time. Grouping still applies inside it.
  const live = container && container._working && container.contains(container._working)
    ? container._working.querySelector('.agent-working-items') : null;
  if (live) {
    // Not open by default, even while active: the rule is one line for what is
    // happening, with the thinking one click away.
    node.classList.remove('open');
    node.querySelector('.agent-fold-head')?.setAttribute('aria-expanded', 'false');
    // Keep live rows flat: a group would put another closed header between
    // the one visible activity line and the preview the user clicked.
    live.appendChild(node);
    return;
  }
  const group = _foldGroupFor(container, node.dataset.foldKind);
  if (!group) { container.appendChild(node); return; }

  group.querySelector('.agent-fold-group-items').appendChild(node);
  _foldGroupSync(group);
  // The fold the user is watching arrive says "still working" with its dots and
  // fills in as text streams: a closed group would hide exactly that row. The
  // group remembers that it opened itself, so the end of the run can shut it
  // again without touching one the user opened.
  if (node.classList.contains('active')) {
    _foldGroupOpen(group, true);
    group.dataset.autoOpened = '1';
  }
}

/**
 * The group a fold of `kind` belongs in, or null when it starts its own run —
 * which is anything other than a fold of the same kind directly before it: a
 * different kind, a message bubble, or an empty transcript.
 */
function _foldGroupFor(container, kind) {
  const last = container.lastElementChild;
  if (!kind || !last || last.dataset.foldKind !== kind) return null;
  if (last.classList.contains('agent-fold-group')) return last;

  const group = _foldGroupCreate(kind);
  last.replaceWith(group);
  group.querySelector('.agent-fold-group-items').appendChild(last);
  return group;
}

function _foldGroupCreate(kind) {
  const el = document.createElement('div');
  el.className = `agent-fold-group agent-fold-group-${kind}`;
  el.dataset.foldKind = kind;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-fold-head agent-fold-group-head';
  head.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'agent-fold-label';
  label.textContent = FOLD_GROUP_LABELS[kind] || kind;

  const count = document.createElement('span');
  count.className = 'agent-fold-count';

  const chevron = document.createElement('span');
  chevron.className = 'agent-fold-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';

  head.append(label, count, chevron);
  head.addEventListener('click', () => {
    const open = !el.classList.contains('open');
    // A deliberate open outranks the automatic close at the end of the run.
    if (open) el.dataset.userOpened = '1'; else delete el.dataset.userOpened;
    delete el.dataset.autoOpened;
    _foldGroupOpen(el, open);
  });

  const items = document.createElement('div');
  items.className = 'agent-fold-group-items';

  el.append(head, items);
  return el;
}

function _foldGroupOpen(group, on) {
  group.classList.toggle('open', !!on);
  group.querySelector('.agent-fold-group-head').setAttribute('aria-expanded', on ? 'true' : 'false');
}

/**
 * Re-read a group after a fold joined or left it: refresh the count, and undo
 * the group once it is down to one fold, because a single fold must look and
 * behave exactly as it does with no group around it.
 */
function _foldGroupSync(group) {
  const folds = group.querySelector('.agent-fold-group-items').children;
  if (folds.length > 1) {
    group.querySelector('.agent-fold-count').textContent = `× ${folds.length}`;
    return;
  }
  if (folds.length === 1) group.replaceWith(folds[0]);
  else group.remove();
}

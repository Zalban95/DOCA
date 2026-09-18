/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SHARED UTILITIES
   ═══════════════════════════════════════════════════════ */

/**
 * Fetch JSON from the API. Throws on HTTP errors.
 * @param {string} url
 * @param {{method?:string, body?:object}} opts
 */
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  if (text.trimStart().startsWith('<'))
    throw new Error('Server returned HTML — run: git pull && sudo systemctl restart openclaw-panel');
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Bad JSON from ${url}: ${e.message}`); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/**
 * Escape HTML special characters (single shared implementation).
 *
 * Quotes are included so the result is safe in an attribute as well as in text
 * — `title="${escHtml(name)}"` used to break on a name containing one. It is
 * still not enough for a JS string inside an event attribute, because the
 * browser decodes entities before parsing the script: use jsArg() there.
 *
 * @param {string} str
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Escape a value for use as a JavaScript string argument inside an inline
 * event attribute: `onclick="doThing(${jsArg(name)})"` — note, no quotes of
 * your own around it.
 *
 * escHtml() is not enough there. It leaves quotes alone, so a value containing
 * one ("Al's watch") ends the string literal early and the handler dies with a
 * syntax error — a button that silently does nothing when clicked, with the
 * only clue in the console. JSON.stringify does the quoting and JS escaping;
 * the entity pass keeps the result intact inside a double-quoted attribute.
 *
 * @param {*} value
 * @returns {string} a quoted JS string literal, attribute-safe
 */
function jsArg(value) {
  return escHtml(JSON.stringify(String(value ?? '')));
}

/**
 * POST JSON to an SSE endpoint and dispatch parsed `data: {...}` events.
 * Uses buffered decoding so events split across chunks are handled correctly.
 *
 * @param {string} url
 * @param {object|null} body - JSON body (null/undefined for empty POST)
 * @param {{
 *   method?:  string,                    - HTTP method (default POST)
 *   onEvent?: (obj: object) => void,     - every parsed event object
 *   onStatus?:(text: string) => void,    - convenience: obj.status chunks
 *   onDone?:  (obj: object) => void,     - event with truthy obj.done
 *   onError?: (err: Error) => void,      - network/stream failure
 * }} handlers
 * @returns {Promise<void>} resolves when the stream ends
 */
async function sseStream(url, body, handlers = {}) {
  const { method, onEvent, onStatus, onDone, onError, signal } = handlers;
  try {
    const res = await fetch(url, {
      method:  method || 'POST',
      headers: body != null ? { 'Content-Type': 'application/json' } : {},
      body:    body != null ? JSON.stringify(body) : undefined,
      // Aborting here closes the response stream, which is what the server is
      // listening for: every SSE handler that drives a turn ties res.on('close')
      // to the turn's own AbortController. So Stop is not a message we send —
      // it is us hanging up, and the turn notices.
      signal,
    });
    if (!res.ok && !res.body) throw new Error(res.statusText);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                       // keep partial line for next chunk
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let obj;
        try { obj = JSON.parse(line.slice(6)); } catch { continue; }
        if (onEvent) onEvent(obj);
        if (typeof obj === 'string') {           // plain-string payloads (e.g. log lines)
          if (onStatus) onStatus(obj);
          continue;
        }
        if (onStatus && obj.status !== undefined) onStatus(obj.status);
        if (onDone && obj.done) onDone(obj);
      }
    }
  } catch (e) {
    // Hanging up on purpose is not an error. Without this every Stop paints a
    // red "The user aborted a request" under the answer it just stopped.
    if (e.name === 'AbortError') return;
    if (onError) onError(e); else throw e;
  }
}

/**
 * Append streamed text to a <pre>/output element and keep it scrolled.
 * Common companion to sseStream's onStatus.
 * @param {HTMLElement} el
 * @param {string} text
 */
function appendStream(el, text) {
  if (!el) return;
  el.textContent += text;
  el.scrollTop = el.scrollHeight;
}

/**
 * How many trailing characters of `s` could be the start of `tag`.
 * Used so a streamed `<think>` split across SSE chunks is not emitted as text.
 */
function _tagHold(s, tag) {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(s.slice(-n))) return n;
  }
  return 0;
}

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
    append(t) { body.textContent += t; setPreview(); },
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

/**
 * The last rows of a finished run stay; everything above them goes behind "…".
 *
 * Closing the folds is not enough once a turn has run fifteen tools: fifteen
 * one-line rows still push the answer off the screen, and the answer is the
 * thing being waited for. Only the tail is worth having by default — the recent
 * steps are the ones a reader is still holding in their head — so the rest
 * collapse into a single row that says how many there are.
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
const FOLD_RUN_KEEP = 3;

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
    if (isRow(el) || el.classList.contains('agent-fold-more')) continue;
    if (!el.textContent.trim() && !el.querySelector('img, video, audio, svg, canvas')) el.remove();
  }

  // What a run is made of, and it is not only folds. A model that narrates
  // ("Checking the next one…") puts a text bubble between every step, so runs
  // of folds alone came out three rows long and never reached the threshold —
  // the harness console looked fixed and the floating chat did not, purely
  // because one conversation happened to narrate and the other did not.
  // The working of a turn is everything the agent did *and* said on the way to
  // its answer, so commentary collapses with the steps it belongs to.
  const isWorking = el =>
    isRow(el) || (isBubble(el) && !isUser(el) && !el.classList.contains('agent-image'));

  let run = [];
  const flush = last => {
    // The answer is the end of the turn, not part of its working: a run that
    // reaches the end of a turn gives back its trailing text bubbles, so the
    // thing the user was waiting for is never what gets hidden.
    let rows = run;
    if (last) while (rows.length && isBubble(rows[rows.length - 1])) rows = rows.slice(0, -1);
    if (rows.length > FOLD_RUN_KEEP + 1) _foldRunCollapse(rows.slice(0, rows.length - FOLD_RUN_KEEP));
    run = [];
  };
  const children = [...container.children];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // A run that already has its "…" is left as it is, opened or not: this runs
    // again after every later turn, and re-collapsing would undo a click.
    if (child.classList.contains('agent-fold-more')) { run = []; continue; }
    if (isWorking(child)) { run.push(child); continue; }
    flush(true);                       // a user message, or a picture: the turn ended here
  }
  flush(true);
}

/** A message bubble in either transcript, whoever wrote it. */
function isBubble(el) {
  return el.classList.contains('hc-msg') || el.classList.contains('chat-msg');
}

/** The user's own message, which is where one turn ends and the next begins. */
function isUser(el) {
  return el.classList.contains('hc-user')
    || (el.classList.contains('chat-msg') && el.classList.contains('user'));
}

/** Move `rows` inside one "…" row, in their place in the transcript. */
function _foldRunCollapse(rows) {
  const more = document.createElement('div');
  more.className = 'agent-fold-more';

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'agent-fold-head agent-fold-more-head';
  head.setAttribute('aria-expanded', 'false');
  head.title = `Show the ${rows.length} earlier steps`;

  const label = document.createElement('span');
  label.className = 'agent-fold-label';
  label.textContent = '…';

  // `.agent-fold-preview` rather than a count: every other row reads
  // "LABEL · what it was", so this one says what it is holding in the same
  // voice instead of being a bare number in an otherwise empty row.
  const count = document.createElement('span');
  count.className = 'agent-fold-preview';
  count.textContent = `${rows.length} earlier steps`;

  const chevron = document.createElement('span');
  chevron.className = 'agent-fold-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▸';

  head.append(label, count, chevron);

  const items = document.createElement('div');
  items.className = 'agent-fold-more-items';

  head.addEventListener('click', () => {
    const open = !more.classList.contains('open');
    more.classList.toggle('open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.title = open ? 'Hide them again' : `Show the ${rows.length} earlier steps`;
  });

  rows[0].replaceWith(more);
  for (const row of rows) items.appendChild(row);
  more.append(head, items);
  return more;
}

/**
 * Stream assistant text into thinking folds + plain bubbles, splitting on
 * `<think>…</think>` (DeepSeek / Qwen-style reasoning) even when a tag is cut
 * across chunks. Call `startWaiting()` as soon as the request is in flight so
 * the user sees animated "Thinking…" before the first token.
 *
 * @param {{
 *   mount: (node: HTMLElement) => void,
 *   makeText: () => HTMLElement,
 *   scroll?: () => void,
 * }} ui
 */
function createThinkStream(ui) {
  let think = null;
  let md = null;
  let pending = '';
  let inThink = false;

  const scroll = () => { if (ui.scroll) ui.scroll(); };

  /**
   * The markdown renderer for the current bubble, created with it.
   *
   * Assistant prose is rendered rather than shown raw, here and everywhere
   * else it lands — the model writes headings, tables and fenced blocks, and
   * unrendered they arrive as their own punctuation. Thinking is not: a
   * `<think>` body stays the literal text the model wrote, because a fold is
   * the record of what it was thinking and nothing about reading that back
   * should be a guess. See public/js/markdown.js.
   */
  function ensureMd() {
    if (!md) md = mdStream(ui.makeText());
    return md;
  }

  function ensureThink(active) {
    if (!think) {
      think = agentFold({ kind: 'thinking', label: 'Thinking', active: true });
      ui.mount(think.el);
    }
    think.setActive(active);
    return think;
  }

  /** Drop an empty waiting indicator, or freeze a fold that has content. */
  function settleThink() {
    if (!think) return;
    if (think.isEmpty()) think.remove();
    else think.setActive(false);
    think = null;
  }

  return {
    startWaiting() { ensureThink(true); scroll(); },

    feed(chunk) {
      if (!chunk) return;
      pending += chunk;
      while (pending.length) {
        if (!inThink) {
          const i = pending.indexOf('<think>');
          if (i === -1) {
            const hold = _tagHold(pending, '<think>');
            const emit = pending.slice(0, pending.length - hold);
            pending = pending.slice(pending.length - hold);
            if (emit) { settleThink(); ensureMd().feed(emit); }
            break;
          }
          const before = pending.slice(0, i);
          if (before) { settleThink(); ensureMd().feed(before); }
          pending = pending.slice(i + 7);
          inThink = true;
          ensureThink(true);
        } else {
          const i = pending.indexOf('</think>');
          if (i === -1) {
            const hold = _tagHold(pending, '</think>');
            const emit = pending.slice(0, pending.length - hold);
            pending = pending.slice(pending.length - hold);
            if (emit) ensureThink(true).append(emit);
            break;
          }
          ensureThink(true).append(pending.slice(0, i));
          pending = pending.slice(i + 8);
          inThink = false;
          settleThink();
        }
      }
      scroll();
    },

    /** Next assistant prose starts a new bubble (after a tool call). */
    resetText() { if (md) { md.end(); md = null; } },

    finish() {
      if (pending) {
        if (inThink) { ensureThink(false).append(pending); think = null; }
        else { settleThink(); ensureMd().feed(pending); }
        pending = '';
        inThink = false;
      } else {
        settleThink();
      }
      // The last block is closed out rather than left as the in-progress one,
      // so a finished message is built exactly like the same message re-read
      // from history.
      if (md) { md.end(); md = null; }
      scroll();
    },
  };
}

/**
 * Media in the transcript: a picture drawn, a video or a sound with a player.
 *
 * Built from elements, never innerHTML, and the address is always the panel's
 * own attachment route built from a name — never a URL a model wrote. A chat
 * that draws markdown images fetches whatever address the model was talked into
 * writing, which is how a prompt injection sends a conversation to someone
 * else's server; that is why text stays text here.
 *
 * The same three kinds the Files tab previews, so a file that plays when you
 * click it there plays when the agent sends it here. `kind` comes from the
 * server (`attachments.playableKind`); the extension is only a fallback for
 * rows written before it was recorded.
 *
 * @param {{ name: string, kind?: 'image'|'audio'|'video', mime?: string, caption?: string }} media
 * @param {() => void} [onLoad]  e.g. scroll the transcript once the height is known
 */
function agentImageEl(media, onLoad) {
  const url  = `/api/attachments/${encodeURIComponent(media.name)}`;
  const kind = media.kind || _mediaKindOf(media.mime, media.name) || 'image';

  const fig = document.createElement('figure');
  fig.className = `agent-image agent-media-${kind}`;

  const fail = note => {
    fig.classList.add('missing');
    fig.textContent = `${media.name} ${note}`;
  };

  if (kind === 'audio' || kind === 'video') {
    // Controls and nothing else: no autoplay, because a transcript that starts
    // talking when it is reopened is a transcript nobody reopens.
    const el = document.createElement(kind);
    el.src = url; el.controls = true; el.preload = 'metadata';
    if (onLoad) el.addEventListener('loadedmetadata', onLoad, { once: true });
    el.addEventListener('error', () => fail('cannot be played — it is no longer in the attachments folder'), { once: true });
    fig.appendChild(el);
  } else {
    const link = document.createElement('a');
    link.href = url; link.target = '_blank'; link.rel = 'noopener';
    link.title = 'Open full size';
    const img = document.createElement('img');
    img.src = url; img.alt = media.caption || media.name;
    // Not loading="lazy": a lazy image has no size until it loads, a shrink-to-fit
    // chat bubble gives it none, and the browser then never finds it near the
    // viewport — the floating chat drew a 2 px box and never fetched it.
    img.decoding = 'async';
    if (onLoad) img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', () => {
      fig.classList.add('missing');
      img.remove();
      link.textContent = `${media.name} is no longer in the attachments folder`;
    }, { once: true });
    link.appendChild(img);
    fig.appendChild(link);
  }

  if (media.caption) {
    const cap = document.createElement('figcaption');
    cap.textContent = media.caption;
    fig.appendChild(cap);
  }
  return fig;
}

/**
 * What a chat does with this file, or null when it is not media at all.
 *
 * The server says so on anything it sent (`attachments.playableKind`); this is
 * for the other direction — a row that stores only the name, and a reloaded
 * transcript that has to decide whether a file the user attached is a picture
 * to draw or a zip to leave alone. Null is the useful half: it is what keeps a
 * PDF out of an `<img>`.
 */
function _mediaKindOf(mime, name = '') {
  const m = String(mime || '');
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  const ext = String(name).split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'opus', 'flac', 'aac', 'weba'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  return null;
}

/**
 * Split stored assistant content that may contain `<think>` blocks into
 * thinking folds + plain text, for history reload.
 *
 * @param {string} content
 * @param {{
 *   mount: (node: HTMLElement) => void,
 *   makeText: (text: string) => void,
 * }} ui
 */
function renderThoughtfulContent(content, ui) {
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(last, m.index);
    if (before) ui.makeText(before);
    const fold = agentFold({ kind: 'thinking', label: 'Thinking', body: m[1], open: false });
    ui.mount(fold.el);
    last = m.index + m[0].length;
  }
  const rest = content.slice(last);
  if (rest || last === 0) ui.makeText(rest);
}

/**
 * Reveal a streaming output box and bring it into view so the process
 * lines are visible from the first chunk.
 * @param {HTMLElement} el
 * @param {string} [initialText]
 */
function showStream(el, initialText = '') {
  if (!el) return;
  el.style.display = 'block';
  el.textContent = initialText;
  requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

/**
 * Standard tool row: status icon, label, version, note and actions
 * (⬇ Install when missing & installable, doc link, ⚙ gear when settable).
 * Used by Settings → System, the Models tab AI Tools card, and any other
 * tool list that needs the same look.
 *
 * @param {{
 *   id: string, label: string, note?: string,
 *   detected: boolean, version?: string|null,
 *   canInstall?: boolean, installing?: boolean, installOnclick?: string,
 *   updateOnclick?: string,  - opt-in: shows ↻ Update once the tool is detected
 *   gearOnclick?: string, repo?: string, repoLabel?: string,
 *   extraActions?: string,   - pre-built HTML appended to the actions cell
 * }} t
 * @returns {string} HTML
 */
function toolRowHtml(t) {
  const statusIcon = t.detected ? '✓' : '✗';
  const cls        = t.detected ? 'tool-ok' : 'tool-missing';

  const versionStr = t.detected && t.version
    ? `<span class="tool-version">${escHtml(t.version)}</span>` : '';

  const installBtn = !t.detected && t.canInstall && t.installOnclick
    ? `<button class="btn btn-xs btn-teal" onclick="${t.installOnclick}" ${t.installing ? 'disabled' : ''}>
         ${t.installing ? '⏳ Installing…' : '⬇ Install'}
       </button>`
    : '';

  // Re-running an installer is how most of these tools update (apt reinstalls
  // the current release, vendor scripts fetch the latest, git-backed stacks
  // pull). Opt-in per caller: not every tool list wants the extra button.
  const updateBtn = t.detected && t.updateOnclick
    ? `<button class="btn btn-xs" onclick="${t.updateOnclick}" ${t.installing ? 'disabled' : ''}
               title="Re-run the installer to update to the latest version">
         ${t.installing ? '⏳ Updating…' : '↻ Update'}
       </button>`
    : '';

  const repoLink = !t.detected && t.repo
    ? `<a class="tool-repo" href="${t.repo}" target="_blank" title="${t.repo}">${escHtml(t.repoLabel || t.repo)}</a>`
    : '';

  const manualNote = !t.detected && !t.canInstall && !t.extraActions
    ? `<span class="tool-manual">manual install</span>`
    : '';

  const gearBtn = t.gearOnclick
    ? `<button class="btn btn-xs tool-gear" title="Settings" onclick="${t.gearOnclick}">⚙</button>`
    : '';

  return `<div class="tool-row ${cls}" id="tool-row-${t.id}">
    <span class="tool-status">${statusIcon}</span>
    <span class="tool-label">${escHtml(t.label)}</span>
    ${versionStr}
    <span class="tool-note">${escHtml(t.note || '')}</span>
    <span class="tool-actions">${t.extraActions || ''}${installBtn}${updateBtn}${repoLink}${manualNote}${gearBtn}</span>
  </div>`;
}

/** How long a status line that is not an error stays up. */
const STATUS_CLEAR_MS = 3000;

/** The pending clear for each element, so the next line can cancel it. */
const STATUS_TIMERS = new WeakMap();

/**
 * Set text + class on a status element, and decide how long the line lives.
 *
 * The rule is "success fades, errors stay". Three seconds is not a new number —
 * it is what the few panels that cleared their own line already used — but it
 * is now one number in one place instead of a `setTimeout` behind every third
 * call site, and the lines that never cleared at all now clear too. A ✗ is the
 * exception, and it is the point of the rule: it is the one message that has to
 * survive the user looking away, because a failure that has erased itself reads
 * as nothing having happened — in a panel whose whole job is saying when
 * something did not.
 *
 * `opts.clear` overrides the schedule for one call: a number of ms, or 0 for a
 * line that reports a standing state (why a toggle is greyed out, which service
 * is running) rather than an event. Those are replaced by the next report, not
 * by a clock.
 *
 * @param {HTMLElement} el
 * @param {string} msg
 * @param {string} [cls] - 'ok' | 'err' | 'info' | 'warn'
 * @param {{clear?: number}} [opts]
 */
function setStatus(el, msg, cls, opts = {}) {
  if (!el) return;

  // Otherwise the previous line's clear fires under this one: a ✓ schedules a
  // wipe, the next call draws a ✗, and three seconds later the stale timer
  // erases an error nobody has read yet.
  const pending = STATUS_TIMERS.get(el);
  if (pending) { clearTimeout(pending); STATUS_TIMERS.delete(el); }

  el.textContent = msg;
  el.className = `status-line ${cls || ''}`;
  if (!msg) return;   // an empty message is how callers wipe a line

  // An error is the exception; an explicit `clear` on the call beats both.
  const ms = opts.clear != null ? opts.clear : cls === 'err' ? 0 : STATUS_CLEAR_MS;
  if (ms > 0) STATUS_TIMERS.set(el, setTimeout(() => setStatus(el, ''), ms));
}

/**
 * Pipe an SSE response body into an element, then call onDone.
 * @param {Response} res
 * @param {HTMLElement} el
 * @param {Function|null} onDone
 */
function streamToEl(res, el, onDone) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) { if (onDone) onDone(); return; }
      const text = decoder.decode(value);
      text.split('\n').forEach(line => {
        if (line.startsWith('data: ')) {
          try { el.textContent += JSON.parse(line.slice(6)); } catch {}
        }
      });
      el.scrollTop = el.scrollHeight;
      read();
    });
  }
  read();
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @param {number} [dp=1]
 */
function fmtBytes(bytes, dp = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dp)) + ' ' + sizes[i];
}

/**
 * Format a large count to compact form (1.2K, 3.4M).
 * @param {number} n
 */
function fmtNumber(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/**
 * Format a duration in seconds as "3d 4h 12m" (short, human-readable).
 * @param {number} sec
 */
function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Format a date string to short locale format.
 * @param {string} dateStr
 */
function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12: false });
  } catch { return dateStr; }
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} ms
 */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Show a styled in-app confirmation modal.
 * @param {string} message
 * @param {Function} onConfirm
 * @param {Function} [onCancel]
 */
/* ── System-tools shared cache + installer ───────────── */

let _systemToolsCache = null;

/**
 * Fetch /api/system/tools once and cache the result (shared by the Models
 * tab badges and anything else needing detection state).
 * @param {boolean} [force] - bypass the cache
 */
async function getSystemTools(force = false) {
  if (_systemToolsCache && !force) return _systemToolsCache;
  const data = await apiFetch('/api/system/tools');
  _systemToolsCache = data.tools || [];
  return _systemToolsCache;
}

/**
 * Install a system tool by id (single shared install path — same endpoint
 * the Settings → System panel uses), streaming output into `outEl`.
 * Prompts for the sudo password when the tool requires it.
 * @param {string} id - system tool id (e.g. 'ollama', 'huggingface-cli')
 * @param {HTMLElement|null} outEl - <pre> for streamed output
 * @param {Function} [onDone] - called with the final done event
 */
async function systemToolInstall(id, outEl, onDone) {
  let tool = null;
  try { tool = (await getSystemTools()).find(t => t.id === id); } catch {}

  const run = async password => {
    showStream(outEl, `Installing ${id}…\n`);
    const body = { id };
    if (password) body.password = password;
    await sseStream('/api/system/tools/install', body, {
      onStatus: text => appendStream(outEl, text),
      onDone:   obj => { _systemToolsCache = null; if (onDone) onDone(obj); },
      onError:  e => { if (outEl) outEl.textContent += `\nError: ${e.message}`; },
    });
  };

  if (tool?.needsSudo) {
    sudoAsk(`Installing "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // cancelled
      run(pw);
    });
  } else {
    run(null);
  }
}

/**
 * Show a "node-pty missing" error banner inside a terminal container.
 * Only shown when the WS connection fails before ever opening.
 * @param {HTMLElement} container - the xterm container element
 */
function ptyErrorBanner(container) {
  if (!container || container.querySelector('.term-pty-error')) return;
  const el = document.createElement('div');
  el.className = 'term-pty-error';
  el.innerHTML = `
    <span class="term-pty-error-icon">⚠</span>
    <div class="term-pty-error-body">
      <strong>Terminal unavailable</strong>
      <span>node-pty is not installed. This native addon is required for embedded terminals.</span>
      <div class="term-pty-error-actions">
        <button class="btn btn-xs btn-teal" onclick="
          nav('settings');
          setTimeout(() => document.getElementById('sysdeps-list')?.scrollIntoView({ behavior: 'smooth' }), 200);
        ">Open Settings → System Tools</button>
      </div>
    </div>`;
  container.style.position = 'relative';
  container.appendChild(el);
}

/**
 * Show a styled in-app prompt modal (replaces browser prompt()).
 * @param {string} message
 * @param {Function} onSubmit - called with the entered string
 * @param {string} [defaultValue]
 * @param {{ allowEmpty?: boolean }} [opts] - `allowEmpty` for a prompt whose
 *   answer is optional, where OK doing nothing would look broken
 */
function appPrompt(message, onSubmit, defaultValue, opts = {}) {
  const modal = document.getElementById('app-prompt-modal');
  const msgEl = document.getElementById('app-prompt-message');
  const input = document.getElementById('app-prompt-input');
  const btnOk = document.getElementById('app-prompt-ok');
  const btnCan = document.getElementById('app-prompt-cancel');
  if (!modal) { const v = prompt(message, defaultValue || ''); if (v !== null) onSubmit(v); return; }

  msgEl.textContent = message;
  input.value = defaultValue || '';
  modal.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick = null;
    btnCan.onclick = null;
    input.onkeydown = null;
  };

  const submit = () => {
    const val = input.value.trim();
    if (!val && !opts.allowEmpty) return;
    cleanup();
    onSubmit(val);
  };

  btnOk.onclick = submit;
  btnCan.onclick = cleanup;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') cleanup();
  };
}

function appConfirm(message, onConfirm, onCancel) {
  const modal   = document.getElementById('app-confirm-modal');
  const msgEl   = document.getElementById('app-confirm-message');
  const btnOk   = document.getElementById('app-confirm-ok');
  const btnCan  = document.getElementById('app-confirm-cancel');
  if (!modal) { if (confirm(message)) onConfirm(); else if (onCancel) onCancel(); return; }

  msgEl.textContent = message;
  modal.classList.add('open');

  const cleanup = () => {
    modal.classList.remove('open');
    btnOk.onclick   = null;
    btnCan.onclick  = null;
  };

  btnOk.onclick  = () => { cleanup(); onConfirm(); };
  btnCan.onclick = () => { cleanup(); if (onCancel) onCancel(); };
}

/**
 * Show a one-button in-app notice (replaces browser alert()).
 * Reuses the confirm modal with the Cancel button hidden.
 * @param {string} message
 * @param {Function} [onClose]
 */
function appAlert(message, onClose) {
  const modal  = document.getElementById('app-confirm-modal');
  const msgEl  = document.getElementById('app-confirm-message');
  const btnOk  = document.getElementById('app-confirm-ok');
  const btnCan = document.getElementById('app-confirm-cancel');
  if (!modal) { alert(message); if (onClose) onClose(); return; }

  msgEl.textContent = message;
  btnCan.style.display = 'none';
  const prevOkClass = btnOk.className;
  btnOk.className = 'btn btn-sm btn-blue';
  btnOk.textContent = 'OK';
  modal.classList.add('open');

  btnOk.onclick = () => {
    modal.classList.remove('open');
    btnCan.style.display = '';
    btnOk.className = prevOkClass;
    btnOk.textContent = 'Confirm';
    btnOk.onclick = null;
    if (onClose) onClose();
  };
}

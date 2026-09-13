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
  const { method, onEvent, onStatus, onDone, onError } = handlers;
  try {
    const res = await fetch(url, {
      method:  method || 'POST',
      headers: body != null ? { 'Content-Type': 'application/json' } : {},
      body:    body != null ? JSON.stringify(body) : undefined,
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
  if (opts.open)   el.classList.add('open');

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
  });

  el.append(head, body);

  return {
    el, body,
    setActive(on) { el.classList.toggle('active', !!on); },
    setOpen(on) {
      el.classList.toggle('open', !!on);
      head.setAttribute('aria-expanded', on ? 'true' : 'false');
    },
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
  // fills in as text streams: a closed group would hide exactly that row.
  if (node.classList.contains('active')) _foldGroupOpen(group, true);
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
  head.addEventListener('click', () => _foldGroupOpen(el, !el.classList.contains('open')));

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
  let textEl = null;
  let pending = '';
  let inThink = false;

  const scroll = () => { if (ui.scroll) ui.scroll(); };

  function ensureText() {
    if (!textEl) textEl = ui.makeText();
    return textEl;
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
            if (emit) { settleThink(); ensureText().textContent += emit; }
            break;
          }
          const before = pending.slice(0, i);
          if (before) { settleThink(); ensureText().textContent += before; }
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
    resetText() { textEl = null; },

    finish() {
      if (pending) {
        if (inThink) { ensureThink(false).append(pending); think = null; }
        else { settleThink(); ensureText().textContent += pending; }
        pending = '';
        inThink = false;
      } else {
        settleThink();
      }
      scroll();
    },
  };
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

/**
 * Set text + class on a status element.
 * @param {HTMLElement} el
 * @param {string} msg
 * @param {string} [cls] - 'ok' | 'err' | 'info' | 'warn'
 */
function setStatus(el, msg, cls) {
  if (!el) return;
  el.textContent = msg;
  el.className = `status-line ${cls || ''}`;
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

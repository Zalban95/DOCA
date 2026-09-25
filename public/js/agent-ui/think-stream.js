/* ═══════════════════════════════════════════════════════
   Assistant text, live and reloaded: <think> blocks become folds, the rest
   is rendered markdown. Shared by chat.js and harness.js.
   ═══════════════════════════════════════════════════════ */

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

    // The provider's separate reasoning field is literal text, not markup to
    // parse as <think> tags, and must never enter the answer or speech buffer.
    feedThinking(chunk) {
      if (!chunk) return;
      ensureThink(true).append(chunk);
      scroll();
    },

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

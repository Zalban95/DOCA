'use strict';

/**
 * What the person actually heard of a spoken answer (asked 2026-10-05). A live call reads an answer aloud a sentence
 * at a time; when the person talks over it and real words come through (public/js/chat-call-hold.js), the rest is
 * never heard — so the transcript should not claim it was said. The answer row is cut where listening stopped: its
 * content becomes what was heard, ending in "—", and the unheard rest is kept on the row as `unheard` (never sent to
 * the model: turn/messages.js maps only the fields the API takes). The model's next turn then reads what the person
 * heard, and the panel can still show what it would have said.
 */
const path = require('path');

/** Cut the newest assistant answer of `sessionId` after `heard` (the spoken words, in order). Returns the row, or null. */
function cut(sessionId, heard) {
  const words = String(heard || '').replace(/\s+/g, ' ').trim();
  if (!words) return null;
  const store = require('../store'), docs = require('../db/docs');
  const file = path.join(store.dir('harness/sessions'), `${sessionId}.jsonl`);
  return docs.editLast(`transcript:${sessionId}`, file, row => {
    if (row.role !== 'assistant' || typeof row.content !== 'string' || !row.content.trim() || row.unheard !== undefined) return null;
    const at = endOf(row.content, words);
    if (at < 0 || at >= row.content.trimEnd().length) return null;   // all of it was heard, or it is not this answer
    return { ...row, content: `${row.content.slice(0, at).trimEnd()} —`, unheard: row.content.slice(at).trim(), interrupted: true };
  }, 12);
}

/** Where `heard` ends inside `content`: its last few words found in order (speech drops markdown, so a word match). */
function endOf(content, heard) {
  const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tail = norm(heard).split(' ').slice(-4);
  const re = new RegExp(tail.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+'), 'giu');
  let m, end = -1;
  while ((m = re.exec(content))) end = m.index + m[0].length;
  return end;
}

module.exports = { cut, endOf };

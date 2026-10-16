'use strict';

/**
 * Who may read the spill folder (`harness/tool-results/<conversation>/`, turn/messages.js spillTool; review of
 * 2026-10-16): the whole text of a conversation's shortened tool results is that conversation's, as its transcript is.
 * A file tool (read_file, list_dir, search_files, canvas, show_media, check_output — all through common.resolvePath)
 * reaches a conversation's folder only when the turn's person may use that conversation (session-access.mayUse: their
 * own chain; a host every one; a turn with no person, as before accounts, not narrowed). The folder of results with no
 * conversation (`anon`) and the folder itself, which lists every conversation, are a host's. What is in a spill file is
 * read masked (secret-view.js kind 'spill'): a `cat` of the settings or a .env, kept whole there, is not a way around it.
 */
const path = require('path');

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The conversation id `abs` belongs to under the spill folder: '' for the folder itself, null when not under it. */
function conversationOf(abs) {
  const { realOf } = require('../utils');
  const real = p => { try { return realOf(path.resolve(p)); } catch { return path.resolve(p); } };
  const root = require('./spill-keep').root();
  for (const r of [path.resolve(root), real(root)]) for (const a of [path.resolve(abs), real(abs)]) {
    if (same(r, a)) return '';
    const rel = path.relative(r, a);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(/[\\/]/)[0];
  }
  return null;
}

/** Why the turn's person may not reach `abs`, or null. */
function refusal(abs, ctx = {}) {
  const id = conversationOf(abs);
  if (id === null) return null;
  const person = ctx.user;
  const access = require('./session-access');
  if (!person?.id || access.isHost(person)) return null;
  if (id && id !== 'anon' && access.mayUse(person, id)) return null;
  return id ? `${abs} is the saved tool output of a conversation that is not yours — the file tools read only your own conversations' (read_file the path your own results name).`
    : `${abs} holds every conversation's saved tool output; the file tools read only your own conversations' — read_file the path your own results name.`;
}

module.exports = { conversationOf, refusal };

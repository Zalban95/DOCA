'use strict';

/**
 * Which chats of a channel talk to this hive, and as whom (the channel's allowlist), one document per channel
 * (`channel-<name>`). A chat — a Telegram chat id, a Matrix room — is linked only by a code a signed-in person
 * made in the panel and sent from that chat, so a chat speaks as the person who linked it, and a stranger who
 * finds the bot gets instructions and nothing else. `offset` is where the channel's polling got to.
 */
const crypto = require('crypto');
const store = require('../store');

const CODE_TTL_MS = 15 * 60 * 1000;

function forChannel(name) {
  const DOC = `channel-${name}`;
  const read = () => ({ chats: {}, codes: {}, offset: 0, prompts: {}, ...store.readJson(DOC, {}) });
  const write = s => store.writeJson(DOC, s);
  const mutate = fn => { const s = read(); const out = fn(s); write(s); return out; };

  /** A one-time code binding the chat it is sent from to this person. */
  function newCode(userId) {
    return mutate(s => {
      const now = Date.now();
      for (const [c, v] of Object.entries(s.codes)) if (v.expiresAt < now) delete s.codes[c];
      const code = crypto.randomBytes(5).toString('hex').toUpperCase();
      s.codes[code] = { userId, expiresAt: now + CODE_TTL_MS };
      return { code, expiresAt: new Date(now + CODE_TTL_MS).toISOString() };
    });
  }

  function redeem(code) {
    return mutate(s => {
      const hit = s.codes[String(code || '').trim().toUpperCase()];
      if (!hit) return null;
      delete s.codes[String(code).trim().toUpperCase()];
      return hit.expiresAt >= Date.now() ? hit : null;
    });
  }

  const chats = () => read().chats;
  const chat = id => read().chats[String(id)] || null;
  const saveChat = (id, rec) => mutate(s => { s.chats[String(id)] = { ...(s.chats[String(id)] || {}), ...rec }; return s.chats[String(id)]; });
  const removeChat = id => mutate(s => { const was = s.chats[String(id)]; delete s.chats[String(id)]; return was || null; });
  const offset = (empty = 0) => read().offset || empty;
  const setOffset = n => mutate(s => { s.offset = n; });
  /** The message a question was asked in, so it can be closed there when it is answered elsewhere. */
  const promptMessage = (promptId, where) => mutate(s => {
    if (where) s.prompts[promptId] = { ...where, at: Date.now() };
    for (const [k, v] of Object.entries(s.prompts)) if (Date.now() - v.at > 7 * 86400000) delete s.prompts[k];
    return s.prompts[promptId] || null;
  });

  return { newCode, redeem, chats, chat, saveChat, removeChat, offset, setOffset, promptMessage };
}

module.exports = { forChannel, CODE_TTL_MS };

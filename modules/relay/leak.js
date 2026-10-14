'use strict';

/**
 * Is anything leaking through the relay (relay/index.js; the owner's, 2026-10-14: "it can even rely on the stats given
 * from the provider; if the cost is small we can have the redundancy to make sure nothing is leaking")? Per request,
 * with no call of its own: the relay counts what the request it forwarded can explain — the messages, tools and format
 * it sent, the text, reasoning and tool calls that came back — and holds the provider's usage numbers in that same
 * answer against it. Tokens the provider bills beyond what any of that explains (a key used for more than this request,
 * a proxy adding to it, a count that does not belong to it) are an activity warning line, tagged with the caller.
 *
 * The relay's own count is an upper bound, not an estimate: a token is never fewer than 1.5 characters of plain ASCII
 * or than half a character of anything else, plus a fixed allowance per message and for a provider's own tool prompt —
 * so ordinary text, code, other scripts and hex never cross it, and what does is worth a look. A request carrying a
 * picture, a sound or a file is not held to it on the prompt side (their tokens cannot be counted from the bytes), and an
 * answer without usage numbers is not checked at all. At most one line per caller every ten minutes, saying how many
 * more there were since.
 */
const MARGIN = 1.15;            // over the bound by more than this share…
const SLACK = 64;               // …and by more than this many tokens
const QUIET_MS = 10 * 60 * 1000;
const said = new Map();         // via → { at, more }

/** The most tokens `text` can be, as any tokenizer in use counts it. */
function bound(text) {
  const s = String(text || '');
  let ascii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 1.5 + (s.length - ascii) * 2);
}

const opaque = messages => (messages || []).some(m => Array.isArray(m?.content) && m.content.some(p => p && p.type && p.type !== 'text'));

/** What the prompt side of `body` can explain, or null when it carries something not counted from its bytes. */
function promptBound(body) {
  if (opaque(body?.messages)) return null;
  const n = (body?.messages || []).length;
  const extra = JSON.stringify([body?.tools || [], body?.tool_choice || '', body?.functions || [], body?.response_format || ''] );
  return bound(JSON.stringify(body?.messages || [])) + bound(extra) + 16 * n + (body?.tools || body?.functions ? 1024 : 0) + 256;
}

const fnText = calls => (calls || []).map(c => `${c?.function?.name || ''}${c?.function?.arguments || ''}`).join('');

/** Everything an answer said that is billed as completion: every choice's text, reasoning and tool calls. */
function replyText(json) {
  return (json?.choices || []).map(c => `${c?.message?.content || ''}${c?.message?.reasoning_content || c?.message?.reasoning || ''}${fnText(c?.message?.tool_calls)}`).join('');
}

/** The same for one stream frame. */
function deltaText(f) {
  return (f?.choices || []).map(c => `${c?.delta?.content || ''}${c?.delta?.reasoning_content || c?.delta?.reasoning || ''}${fnText(c?.delta?.tool_calls)}`).join('');
}

const over = (reported, explained) => explained != null && reported > explained * MARGIN + SLACK;

/**
 * Hold one request's provider usage against what it explains. → { ok, prompt, completion } (null when unchecked), and a
 * warning line in the activity log when it is not ok.
 */
function check({ via, person = null, provider, model, body, content, usage, now = Date.now() }) {
  const p = Number(usage?.prompt_tokens), c = Number(usage?.completion_tokens);
  if (!(p >= 0) || !(c >= 0)) return null;
  const hidden = Number(usage?.completion_tokens_details?.reasoning_tokens) || 0;   // reasoning a provider bills and does not show
  const prompt = { reported: p, explained: promptBound(body) };
  const completion = { reported: c, explained: bound(content) + hidden + 32 * Math.max(1, Number(body?.n) || 1) };
  const bad = [over(prompt.reported, prompt.explained) && `${p} prompt tokens where the request explains at most ${prompt.explained}`,
    over(completion.reported, completion.explained) && `${c} completion tokens where the answer explains at most ${completion.explained}`].filter(Boolean);
  if (!bad.length) return { ok: true, prompt, completion };
  const last = said.get(via);
  if (last && now - last.at < QUIET_MS) { last.more++; return { ok: false, prompt, completion, quiet: true }; }
  said.set(via, { at: now, more: 0 });
  require('../activity').note({ from: 'relay', level: 'warn', via, person,
    what: `the provider ${provider} counted more for a relay request (${model}) than it explains: ${bad.join('; ')}`,
    why: `tokens no relay request explains — a key used elsewhere, or a count that is not this request's${last?.more ? `; ${last.more} more like it since the last line` : ''}` });
  return { ok: false, prompt, completion };
}

module.exports = { check, bound, promptBound, replyText, deltaText, _said: said };

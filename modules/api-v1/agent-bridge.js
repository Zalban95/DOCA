'use strict';

/**
 * Server-side resolver for free-form prompt selections (`resolver: "server"`).
 *
 * Takes the prompt context plus the user's free input (text, voice
 * transcript, or an image) and asks the OpenClaw gateway — the same
 * OpenAI-compatible chat-completions endpoint the dashboard chat uses — for
 * a structured outcome. Zero agent-side changes are needed for this path.
 */
const { loadGatewayChatConfig } = require('../chat');
const commands = require('./commands');

const SYSTEM = `You are the decision resolver for a control panel worn on a small device.
The user was shown a prompt with a few choices and instead answered freely.
Reply with ONE JSON object and nothing else, shaped exactly like:
{"summary": "<= 120 chars, what will happen", "detail": "<= 400 chars, optional",
 "action": {"commandId": "<one of the allowed command ids or omit>", "params": {}} ,
 "confirmLabel": "<= 20 chars"}
Only use a commandId from the allowed list. If nothing should be executed, omit "action".`;

function textOfBlocks(blocks) {
  return (blocks || []).map(b => b.type === 'text' ? b.text : b.type === 'kv' ? b.items.map(i => `${i.k}: ${i.v}`).join(', ') : b.type === 'list' ? b.items.join('; ') : b.alt || '').filter(Boolean).join('\n');
}

/**
 * @param {object} prompt   stored prompt
 * @param {object} input    { kind: 'text'|'voice'|'image', text?, transcript?, imageBuffer?, imageMime?, caption? }
 * @returns {Promise<object>} outcome candidate (unvalidated)
 */
async function resolve(prompt, input) {
  const gw = loadGatewayChatConfig();
  if (!gw?.url) throw Object.assign(new Error('Gateway chat completions not configured (gateway.http.endpoints.chatCompletions)'), { code: 'resolver_unavailable' });

  const allowed = commands.ids().filter(id => !prompt.allowedCommands || prompt.allowedCommands.includes(id));
  const context = [
    `Prompt title: ${prompt.title}`,
    `Prompt body: ${textOfBlocks(prompt.body)}`,
    `Offered choices: ${prompt.choices.filter(c => c.type === 'option').map(c => `${c.label} → ${c.outcome.summary}`).join(' | ') || '(none)'}`,
    `Allowed command ids: ${allowed.join(', ')}`,
    `Command params: ${allowed.map(id => `${id}(${Object.keys(commands.get(id).params).join(',')})`).join(' ')}`,
  ].join('\n');

  const userText = input.kind === 'image'
    ? `The user answered with a photo${input.caption ? ` and said: "${input.caption}"` : ''}.`
    : `The user answered: "${input.text || input.transcript || ''}"`;

  const userContent = input.kind === 'image' && input.imageBuffer
    ? [{ type: 'text', text: `${context}\n\n${userText}` },
       { type: 'image_url', image_url: { url: `data:${input.imageMime || 'image/jpeg'};base64,${input.imageBuffer.toString('base64')}` } }]
    : `${context}\n\n${userText}`;

  const headers = { 'Content-Type': 'application/json', 'x-openclaw-agent-id': 'main' };
  if (gw.token) headers.Authorization = `Bearer ${gw.token}`;
  const resp = await fetch(gw.url, {
    method: 'POST', headers,
    body: JSON.stringify({ model: 'openclaw', stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw Object.assign(new Error(`Gateway ${resp.status}: ${(await resp.text()).slice(0, 200)}`), { code: 'resolver_failed' });
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseOutcome(text);
}

/** Extract the first JSON object from a model reply (tolerates code fences and prose). */
function parseOutcome(text) {
  const cleaned = String(text).replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw Object.assign(new Error('Resolver reply contained no JSON object'), { code: 'resolver_bad_reply', raw: text.slice(0, 200) });
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw Object.assign(new Error('Resolver reply was not valid JSON'), { code: 'resolver_bad_reply', raw: text.slice(0, 200) }); }
}

module.exports = { resolve, parseOutcome, SYSTEM };

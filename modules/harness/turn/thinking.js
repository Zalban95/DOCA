'use strict';

/**
 * Whether a turn thinks, by the kind of conversation it is in (asked 2026-10-08: "we need the possibility to enable or
 * disable thinking in specific modes, and, where it doesn't look too bad, even within the mode itself").
 *
 * Each mode has a setting, `thinking.<mode>`: `auto` (what it did before — the triage, assistant mode's effort, the
 * harness's), `off`, or a level (low, medium, high: on). Within a mode the person can change it, and the nearer word
 * wins, first that says:
 *
 *   1. this message asks to think harder ("think harder", "take your time" — turn/front.js DEEP): high, this turn only
 *   2. the call's 💭 toggle (`client.thinking`, sent by the Live or Deep call for the rest of that call)
 *   3. the conversation's own (`session.effort`: the composer's 💭 toggle, or the agent's `effort` tool when asked)
 *   4. the mode's setting, when it is not auto
 *   5. auto: the triage (experiment adaptiveLimits), else effort.levelFor — assistant mode's, else the harness's
 *
 * The level and why travel with the turn: the prompt's line (turn/client.js), an `effort` event that the trace keeps as
 * a span (and Chronicle reads back), and every `usage` event. How a provider hears it is turn/effort.js.
 */
const effort = require('./effort');
const schema = () => require('../../settings-schema');

const MODES = {
  chat:       { label: 'Chat', hint: 'The Orchestrator (the floating chat) and the conversations you start in the Harness console.' },
  work:       { label: 'Work chats', hint: 'Work chats: what the Orchestrator hands work to, ＋ Work in the console, and a project\'s tabs.' },
  specialist: { label: 'Specialists', hint: 'A specialist\'s mission: unwatched work that reports back.' },
  liveCall:   { label: 'Live call', hint: 'The face tapped (assistant mode): quick spoken answers. Auto: assistant mode\'s effort (low).' },
  deepCall:   { label: 'Deep call', hint: 'The chat\'s 🎙: talking something through, answered aloud.' },
  ambient:    { label: 'Ambient', hint: 'Talking to the ambient screen. No toggle on its stage, so this is the only switch.' },
  device:     { label: 'Device calls', hint: 'A call from a paired device, such as the watch through the phone.' },
};
const CHOICES = ['auto', 'off', 'low', 'medium', 'high'];

/** Which mode a turn is in. */
function modeOf({ client, profile, session } = {}) {
  if (client?.mode === 'assistant' || client?.mode === 'call') {
    if (client.ambient) return 'ambient';
    if (client.kind && client.kind !== 'dashboard') return 'device';   // a paired device's call (api-v1/harness.js voiced)
    return client.mode === 'assistant' ? 'liveCall' : 'deepCall';
  }
  if (profile && profile.level !== 'orchestrator') return 'specialist';
  if (session?.kind === 'work') return 'work';
  return 'chat';
}

/** A mode's setting: auto, off or a level. */
const setting = mode => (MODES[mode] ? schema().value(`thinking.${mode}`) : 'auto');

/** What a toggle's "on" means in a mode: the mode's own level when it names one, else medium. */
function onLevel(mode) {
  const s = setting(mode);
  return ['low', 'medium', 'high'].includes(s) ? s : 'medium';
}

/** A toggle's choice as a level: auto → null (nothing of its own), off, on → onLevel, or a level. */
function toggleLevel(choice, mode) {
  if (choice === 'on') return onLevel(mode);
  return effort.LEVELS.includes(choice) ? choice : null;
}

/** A person wrote it, rather than an agent or the hub carrying work on: only then do their words move the level. */
const personal = (client, profile) => !!client && client.kind !== 'agent' && !(profile && profile.level !== 'orchestrator');

/** The turn's level, why, and its mode: { level, from, mode }. */
function resolve({ client, profile, session, message, p, verdict } = {}) {
  const mode = modeOf({ client, profile, session });
  const deep = personal(client, profile) && String(message || '').match(require('./front').DEEP);
  if (deep) return { level: 'high', from: `asked in this message ("${deep[0].toLowerCase()}")`, mode };
  const call = toggleLevel(client?.thinking, mode);
  if (call) return { level: call, from: `toggle: ${call === 'off' ? 'off' : `on (${call})`} — this call`, mode };
  if (effort.LEVELS.includes(session?.effort))
    return { level: session.effort, from: session.effortBy === 'toggle' ? `toggle: ${session.effort === 'off' ? 'off' : `on (${session.effort})`}` : 'this conversation (the effort tool)', mode };
  const s = setting(mode);
  if (s !== 'auto') return { level: s, from: `mode setting: ${s} (thinking.${mode})`, mode };
  const auto = require('./triage').effort(effort.levelFor({ client, p }), verdict);
  return { ...auto, from: auto.from ? `auto: ${auto.from}` : null, mode };
}

/** For the card: each mode with its setting, and how each provider with a key hears it (Advanced). */
function view() {
  const contracts = require('../contracts'), providers = require('../providers');
  const owner = require('../../utils').loadPrefs().providerContracts || {};
  const said = { reasoning_effort: 'reasoning_effort: low, medium, high; off is', reasoning: 'reasoning: {effort} — off is {enabled: false}',
    thinking: 'thinking: {type: enabled | disabled} — low counts as off', enable_thinking: 'chat_template_kwargs.enable_thinking — low counts as off',
    no_think: '/no_think at the end of the prompt when off or low', none: 'nothing: it refused the field once, so none is sent' };
  const rows = providers.list().filter(x => x.hasKey).map(x => {
    const ep = { id: x.id, baseUrl: x.baseUrl }, d = effort.dialect(ep);
    const source = owner[x.id]?.effortField ? 'set by the owner (providerContracts)' : contracts.all()[x.id]?.effortField ? 'learned from a refusal' : 'guessed from its address';
    return { id: x.id, label: x.label, dialect: d, says: d === 'reasoning_effort' ? `${said[d]} ${effort.offWord(ep)}` : said[d], source };
  });
  return { modes: Object.entries(MODES).map(([id, m]) => ({ id, ...m, value: setting(id) })), choices: CHOICES, providers: rows };
}

module.exports = { MODES, CHOICES, modeOf, setting, onLevel, toggleLevel, resolve, view };

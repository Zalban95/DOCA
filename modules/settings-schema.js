'use strict';

/**
 * Every setting, declared once (docs/design/hive.md §1; TODO H2.1). Each top-level key of the prefs file says:
 *
 *   is       travels | local | mixed — whether it means anything on another machine (state-map.js reads this)
 *   home     hive   — the whole DOCA: how its agents behave, what they may do
 *            device — one machine: `on: 'host'` for what is bound to the machine DOCA runs on (paths, ports,
 *                     binaries), `on: 'screen'` for how one screen shows the panel (theme, tabs, sidebar)
 *            person — one person's own (none yet: per-person memory will be)
 *   note     what it is, in a phrase
 *   propose  where in it the agent may point a settings proposal, with the card's label — settings.SETTABLE is
 *            built from these, so a key is proposable by being declared so here, and nowhere else
 *   keys     its leaves that have a type and a default in code: `value()` reads the prefs file through them, so
 *            a default changed here reaches every install that never set one — nothing to migrate
 *
 * test/settings-schema.test.js fails when code reads a prefs key that is not declared here.
 */
const p = (label, note = '', extra = {}) => ({ label, note, ...extra });

const SCHEMA = {
  // ── How one screen shows the panel ──
  theme:            { is: 'travels', home: 'device', on: 'screen', note: 'colour theme', propose: p('Theme') },
  customTheme:      { is: 'travels', home: 'device', on: 'screen', note: 'a theme the person made', propose: p('Custom theme colours') },
  skin:             { is: 'travels', home: 'device', on: 'screen', note: 'the panel skin' },
  hiddenTabs:       { is: 'travels', home: 'device', on: 'screen', note: 'which tabs are hidden', propose: p('Navigation visibility') },
  codeExpanded:     { is: 'travels', home: 'device', on: 'screen', note: 'a UI fold state' },
  sidebarStats:     { is: 'travels', home: 'device', on: 'host', note: 'which stats the host collects for the sidebar (the collectors run here, for every screen)', propose: p('Sidebar stats', 'Which stats the sidebar shows') },
  sidebarSections:  { is: 'travels', home: 'device', on: 'screen', note: 'which sidebar sections are open', propose: p('Sidebar sections') },
  favorites:        { is: 'travels', home: 'device', on: 'screen', note: 'favourite config files, by registry id', propose: p('Config favourites') },
  voice:            { is: 'travels', home: 'device', on: 'screen', note: 'the voice this screen is answered in: ttsVoice and ttsSpeed, over voiceServices (chat.js handleSynthesize)' },
  call:             { is: 'travels', home: 'device', on: 'screen', note: 'how a live call listens on this screen — its microphone is its own (chat-call.js; Settings → Voice → Live call)',
    keys: {
      silenceMs:   { type: 'integer', min: 300, default: 2000, hint: 'How long a pause, in milliseconds, ends what you said and sends it.' },
      sensitivity: { type: 'integer', min: 1, default: 15, hint: 'The microphone level that counts as speech; lower hears quieter voices and more of the room.' },
      assistantIdleSec: { type: 'integer', min: 5, default: 12, hint: 'In assistant mode (the face tapped), seconds of quiet before it goes back to waiting for the wake word, where the screen listens for one.' },
      listenWithFace: { type: 'boolean', default: false, hint: 'While the corner face shows, listen for the wake word and start a call when it is said (experiments.wakeWord).' },
      wakeWord: { type: 'string', default: '', hint: 'The word that starts a call. Empty: the product\'s name (branding).' },
    } },
  face:             { is: 'travels', home: 'device', on: 'screen', note: 'the face: its look, a spec over the default (face/face.js); an edition carries one' },
  hiddenBuiltins:   { is: 'travels', home: 'device', on: 'screen', note: 'built-in config entries hidden from the list', propose: p('Hidden built-ins') },

  // ── The hive: how its agents behave and what they may do ──
  branding:         { is: 'travels', home: 'hive', note: 'the name and look the panel wears' },
  updates:          { is: 'travels', home: 'hive', note: 'how updates are offered' },
  agents:           { is: 'travels', home: 'hive', note: 'whether specialists are switched on',
    propose: p('Specialist agents', 'Allow the orchestrator to dispatch specialists', { prefix: 'agents.enabled', exact: true }) },
  toolNotes:        { is: 'travels', home: 'hive', note: 'notes added to tool descriptions (fingerprinted per tool)',
    propose: p('Tool note', 'Added to the tool\'s description — what the agent reads when it picks the tool') },
  // Numbers only, and deliberately a different key from `mcpServers`, which holds commands this host spawns
  // and stays out of reach. settings.sectionFor matches a whole prefix, so one can never open the other.
  mcpSettings:      { is: 'travels', home: 'hive', note: 'MCP timeouts', propose: p('MCP timeouts', 'How long to wait for an MCP tool before giving up') },
  computers:        { is: 'travels', home: 'hive', note: 'limits on agents\' computers: how many run, when they stop and are removed',
    propose: p('Agents\' computers', 'How many run at once, when they stop and when they are removed'),
    keys: {
      maxRunning:      { type: 'integer', min: 0, default: 4, hint: 'How many agents\' computers may run at once.' },
      idleStopMinutes: { type: 'number', min: 0, default: 10, hint: 'Minutes after its mission ends that a computer stops (its files stay).' },
      retainHours:     { type: 'number', min: 0, default: 72, hint: 'Hours a stopped computer an agent made is kept before it is removed with its files; a pinned one is kept.' },
    } },
  search:           { is: 'travels', home: 'hive', note: 'which web search provider web_search uses, and a SearXNG address (keys live in keys/search.json)',
    propose: p('Web search', 'Which provider web_search uses'),
    keys: { provider: { type: 'string', default: 'duckduckgo', hint: 'searxng, brave, tavily or duckduckgo (no key, the fallback).' },
      url: { type: 'string', default: '', hint: 'The SearXNG instance, when that is the provider (its JSON format must be enabled).' } } },
  // Developer mode: whether this install offers experiments at all. An owner's or a tester's copy turns it on; a
  // customer's install never sees it (admin is for the repository's owners and independent testers). Not proposable,
  // and local: a pack or an edition never carries it.
  developer:        { is: 'local', home: 'device', on: 'host', note: 'developer mode: experiments offered and in effect (experiments.js)',
    keys: { mode: { type: 'boolean', default: false, hint: 'Offer the experiments (Settings → Developer) and let the ones switched on take effect.' },
      releaseUnasked: { type: 'array', default: ['claude-opus >= 5', 'claude-fable >= 5'], hint: 'Models that may merge, tag, push and switch the live panel without asking (CONSTITUTION W2), a family each, optionally with a minimum version. Empty: everyone asks.' } } },
  // Experiments (hive.md §8): off by default, each written up in docs/experiments/<id>.md. The owner's switch alone —
  // never proposable: an agent switching on its own experiments would be grading its own homework.
  experiments:      { is: 'travels', home: 'hive', note: 'experiments switched on (docs/experiments)',
    keys: { recipeRepair: { type: 'boolean', default: false, hint: 'When a recipe fails, the agent investigates and proposes a repaired revision for a person to accept.' },
      retrieval: { type: 'boolean', default: false, hint: 'memory_search and recall_conversations also search by meaning, with the embedding model under retrieval.' },
      bargeIn: { type: 'boolean', default: false, hint: 'In a voice call, speaking while the agent works or talks is sent at once, and what it was about to say is dropped.' },
      realtimeVoice: { type: 'boolean', default: false, hint: 'A live call speaks with a realtime speech model (realtime.*) in place of speech-to-text, a turn and text-to-speech; the model hands real work to the hive.' },
      faceVoice: { type: 'boolean', default: false, hint: 'In a voice call, the corner face moves its mouth with the agent\'s voice and listens when you speak.' },
      wakeWord: { type: 'boolean', default: false, hint: 'A screen showing the corner face listens for the wake word (call.wakeWord) and starts a call when it hears it.' },
      packRegistry: { type: 'boolean', default: false, hint: 'This hub lists the packs a host published to hubs holding a registry token, and can fetch from other hubs\' registries.' },
      modelScout: { type: 'boolean', default: false, hint: 'The model scout: looks for better and new models, files suggestions a person accepts into TODO and hands to an implementer.' },
      visionPass: { type: 'boolean', default: false, hint: 'Agents may look at a computer\'s screen with the vision model under vision.' } } },
  assistant:        { is: 'travels', home: 'hive', note: 'assistant mode: a call started from the face answers quicker and shorter, in its own style (turn/effort.js, turn/client.js)',
    propose: p('Assistant mode', 'How the face answers when spoken to: its style, thinking effort and model'),
    keys: { effort: { type: 'string', default: 'low', hint: 'Thinking effort in assistant mode: off, low, medium, high, or default (send nothing: the model\'s own).' },
      style: { type: 'string', default: 'You are the hive\'s voice, spoken to through its face — a companion who handles things. Answer in one to three short spoken sentences: direct, warm, conversational. No lists, no markdown, nothing read out that belongs on a screen. When something takes work, say in a few words what you are doing and do it; offer to go deeper rather than going deep.',
        hint: 'How assistant mode speaks — the instruction every face-started turn is given.' },
      reply: { type: 'string', default: 'act', hint: 'In a call, a clear request with a visible result: act (do it, answer only ✓ — nothing spoken), brief (a few words) or always (say what was done).' },
      calls: { type: 'boolean', default: false, hint: 'Use this effort and model for the chat\'s 🎙 call too, not only for the face.' },
      provider: { type: 'string', default: '', hint: 'A provider for assistant mode\'s own model. Empty: the conversation\'s.' },
      model: { type: 'string', default: '', hint: 'A quicker model for assistant mode (e.g. a small local one). Empty: the conversation\'s model.' } } },
  scout:            { is: 'travels', home: 'hive', note: 'the model scout: what it watches, how often, where accepted suggestions go and who works on them (modules/scout; the switch is experiments.modelScout)',
    propose: p('Model scout', 'What the scout watches and how often; switching it on is a proposal too'),
    keys: { enabled: { type: 'boolean', default: false, hint: 'Look daily for better or new models and brief every everyDays (a turn of the agent). Off by default.' },
      everyDays: { type: 'number', min: 1, default: 7, hint: 'Days between briefs; a look that finds something notable briefs at once.' },
      growthLikes: { type: 'integer', min: 1, default: 300, hint: 'Likes a model must gain on Hugging Face between two looks to count as growing fast.' },
      watch: { type: 'array', default: ['ggml-org/llama.cpp', 'ollama/ollama', 'remsky/Kokoro-FastAPI', 'fedirz/faster-whisper-server', 'roboflow/inference', 'huggingface/transformers.js'],
        hint: 'GitHub repositories (owner/repo) whose releases the scout follows: what DOCA runs on.' },
      feeds: { type: 'array', default: ['https://huggingface.co/blog/feed.xml'], hint: 'News feeds (RSS or Atom) the scout reads titles from.' },
      repo: { type: 'string', default: '', hint: 'The repository whose TODO.md takes accepted suggestions. Empty: this install\'s own checkout.' },
      implementer: { type: 'string', default: 'doca', hint: 'Who works on an accepted suggestion: doca (a conversation of DOCA\'s agent) or a CLI harness id (claude, codex…).' } } },
  vision:           { is: 'travels', home: 'hive', note: 'how a computer\'s screen is read: a vision model, a detector, OCR or OpenCV (modules/vision; the switch is experiments.visionPass)',
    propose: p('Vision', 'Which reader looks at a computer\'s screen when there is nothing to number, and its model'),
    keys: { backend: { type: 'string', default: 'model', hint: 'The reader computer_look uses unless the agent picks one: model, detector, text or template.' },
      provider: { type: 'string', default: 'ollama', hint: 'The provider serving the vision model; ollama by default.' },
      model: { type: 'string', default: '', hint: 'A model that reads images, e.g. qwen2.5vl or llava on Ollama. Empty: no vision model.' },
      detectorUrl: { type: 'string', default: 'http://127.0.0.1:9001', hint: 'Roboflow Inference: the local server (Settings → Services) or https://detect.roboflow.com.' },
      detectorModel: { type: 'string', default: '', hint: 'The detection model, as project/version (Roboflow Universe or your own). Empty: no detector.' },
      apiKey: { type: 'string', default: '', hint: 'The Roboflow API key, when the model or the hosted API needs one.' },
      ocrLang: { type: 'string', default: 'eng', hint: 'Tesseract\'s languages, e.g. eng or eng+ita (each needs its language pack).' } } },
  realtime:         { is: 'travels', home: 'hive', note: 'the realtime speech service a live call uses (realtime/; the switch is experiments.realtimeVoice)',
    keys: { protocol: { type: 'string', default: 'openai', hint: 'openai — the OpenAI Realtime protocol (OpenAI, Azure, local servers that speak it) — or gemini (Gemini Live).' },
      provider: { type: 'string', default: 'openai', hint: 'The provider whose key and address are used (Field → API keys); google for Gemini Live.' },
      url: { type: 'string', default: '', hint: 'The service\'s WebSocket address, when not derived from the provider (Azure, a local server).' },
      model: { type: 'string', default: '', hint: 'The realtime model, e.g. gpt-realtime or a Gemini Live model. Empty: realtime calls stay off.' },
      voice: { type: 'string', default: '', hint: 'The service\'s voice name; empty is its default.' },
      dialect: { type: 'string', default: 'ga', hint: 'For the OpenAI protocol: ga, or beta for servers that still expect the earlier session shape.' },
      waitSec: { type: 'number', min: 3, default: 20, hint: 'Seconds the voice waits for the hive before saying the work carries on in the background.' } } },
  tracing:          { is: 'travels', home: 'hive', note: 'traces of each turn: whether they are kept, and for how long (harness/trace.js)',
    keys: { enabled: { type: 'boolean', default: true, hint: 'Keep a trace of each turn: model requests, tool calls, waits — names and numbers, never content.' },
      retainDays: { type: 'number', min: 1, max: 3650, default: 30, hint: 'Days a turn\'s trace is kept.' } } },
  retrieval:        { is: 'travels', home: 'hive', note: 'the embedding model retrieval uses (retrieval/; the switch is experiments.retrieval)',
    propose: p('Retrieval', 'Which embedding model searches memory and conversations by meaning'),
    keys: { provider: { type: 'string', default: 'ollama', hint: 'The provider that serves the embedding model (Field → API keys); ollama by default.' },
      model: { type: 'string', default: '', hint: 'An embedding model, e.g. nomic-embed-text or bge-m3 on Ollama. Empty: retrieval stays off.' } } },
  migrations:       { is: 'travels', home: 'hive', note: 'which prefs migrations this file has had, and what they changed (migrations.js) — the record travels with the file' },
  usagePrices:      { is: 'travels', home: 'hive', note: 'the owner\'s price list for the usage window (harness/prices.js)' },
  providerContracts: { is: 'mixed', home: 'hive', note: 'the owner\'s corrections to what a provider accepts (harness/contracts.js): about a remote provider they travel, about a server on this machine they are local' },
  harness:          { is: 'mixed', home: 'hive', note: 'config (model, limits, fallback chain, prompts), the guards\' settings and approval mode travel (the guard model files are local, in the data folder); the always-allowed list names commands of this machine and is local. Provider keys are not here: they live in the data folder (keys/).',
    propose: [p('Harness parameters', 'Includes this agent\'s own model and behaviour', { prefix: 'harness.config' }),
      p('Default harness', 'Which runtime the chat panel talks to', { prefix: 'harness.default' })] },
  models:           { is: 'mixed', home: 'hive', note: 'preferences travel; models.hf.token is a secret and local, and runtime URLs name this machine',
    propose: p('Model manager', 'Ollama URL, download directories') },

  // ── The machine DOCA runs on ──
  paths:            { is: 'local', home: 'device', on: 'host', note: 'folders and URLs of this machine (paths.js SETTABLE)', propose: p('Managed paths', 'Applies after a restart of the panel') },
  fmFavorites:      { is: 'local', home: 'device', on: 'host', note: 'favourite folders: paths of this machine', propose: p('File manager favourites') },
  llamacpp:         { is: 'local', home: 'device', on: 'host', note: 'binary paths and server instances' },
  serviceSettings:  { is: 'local', home: 'device', on: 'host', note: 'ports and URLs of services on this machine', propose: p('Inference services', 'GPU assignment, ports, images') },
  voiceServices:    { is: 'local', home: 'device', on: 'host', note: 'speech services on this machine or the tailnet', propose: p('Voice services') },
  snapshotSettings: { is: 'local', home: 'device', on: 'host', note: 'where snapshots of this machine go', propose: p('Snapshot settings') },
  mcpServers:       { is: 'local', home: 'device', on: 'host', note: 'spawnable commands and URLs — never proposed, never exported' },
  dockerPresets:    { is: 'local', home: 'device', on: 'host', note: 'compose presets for this machine\'s Docker' },
  clientApps:       { is: 'local', home: 'device', on: 'host', note: 'where DOCA\'s Android apps\' repositories are on this machine, to build them (client-apps/)' },
  backup:           { is: 'local', home: 'device', on: 'host', note: 'the backup schedule of this machine' },
  network:          { is: 'local', home: 'device', on: 'host', note: 'how this machine listens, and what may be done from outside the tailnet (network.js)',
    keys: { listen: { type: 'string', default: 'tailnet', hint: 'tailnet (Tailscale and this machine), lan (also the local network), local (this machine only), all (every interface). From the next start.' },
      lanAdmin: { type: 'boolean', default: false, hint: 'Allow managing the machine (admin rights) from outside Tailscale. Off: from the local network a person reads and chats.' } } },
  vms:              { is: 'local', home: 'device', on: 'host', note: 'the libvirt connection URI of this machine', propose: p('Virtual machines', 'The libvirt connection URI') },
  channels:         { is: 'local', home: 'device', on: 'host', note: 'channel bots (Telegram, Matrix, Slack, mail): tokens and a switch for this hub',
    keys: {
      'telegram.enabled': { type: 'boolean', default: false, hint: 'Whether the Telegram bot is polled.' },
      'telegram.pollSec': { type: 'number', min: 0, max: 50, default: 25, hint: 'How long one getUpdates call waits for a message.' },
      'matrix.enabled':   { type: 'boolean', default: false, hint: 'Whether the Matrix bot account is synced.' },
      'matrix.homeserver': { type: 'string', default: '', hint: 'The bot account\'s homeserver, e.g. https://matrix.org.' },
      'matrix.pollSec':   { type: 'number', min: 0, max: 50, default: 25, hint: 'How long one /sync waits for a message.' },
      'slack.enabled':    { type: 'boolean', default: false, hint: 'Whether the Slack app\'s Socket Mode connection is opened.' },
      'mail.enabled':     { type: 'boolean', default: false, hint: 'Whether the mailbox is read and answered.' },
      'mail.pollSec':     { type: 'number', min: 5, max: 3600, default: 60, hint: 'How often the mailbox is read for new mail.' },
    } },
};

/** settings.SETTABLE: where a proposal may point, in declaration order. */
function settable() {
  return Object.entries(SCHEMA).flatMap(([key, d]) => [].concat(d.propose || [])
    .map(x => ({ prefix: x.prefix || key, label: x.label, note: x.note || '', ...(x.exact ? { exact: true } : {}) })));
}

/** The declaration of a leaf (`computers.maxRunning`), or null. */
function leaf(dotted) {
  const [top, ...rest] = String(dotted).split('.');
  return SCHEMA[top]?.keys?.[rest.join('.')] || null;
}

function valid(spec, v) {
  if (v === undefined || v === null || v === '') return false;
  if (spec.type === 'boolean') return typeof v === 'boolean';
  if (spec.type === 'integer' || spec.type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) && (spec.type !== 'integer' || Number.isInteger(n)) && (spec.min === undefined || n >= spec.min) && (spec.max === undefined || n <= spec.max);
  }
  if (spec.type === 'string') return typeof v === 'string';
  if (spec.type === 'array') return Array.isArray(v) && v.every(x => typeof x === 'string');
  return true;
}

/** A declared leaf's value: what the prefs file holds when it is valid for the type, else the default. */
function value(dotted, prefs = require('./utils').loadPrefs()) {
  const spec = leaf(dotted);
  if (!spec) throw new Error(`${dotted} is not a declared setting (modules/settings-schema.js)`);
  const v = String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), prefs);
  if (!valid(spec, v)) return spec.default;
  return spec.type === 'integer' || spec.type === 'number' ? Number(v) : v;
}

/** Every declared leaf with its value — what the agent's settings list and a device page draw. */
function leaves(prefs = require('./utils').loadPrefs()) {
  return Object.entries(SCHEMA).flatMap(([top, d]) => Object.entries(d.keys || {}).map(([k, spec]) => ({
    path: `${top}.${k}`, value: value(`${top}.${k}`, prefs), type: spec.type, default: spec.default, hint: spec.hint, home: d.home, on: d.on || null,
  })));
}

/** For the panel and clients: the declarations, without anything that could be a value. */
function describe() {
  return Object.fromEntries(Object.entries(SCHEMA).map(([k, d]) => [k, { is: d.is, home: d.home, on: d.on || null, note: d.note,
    proposable: !!d.propose, keys: d.keys ? Object.fromEntries(Object.entries(d.keys).map(([n, s]) => [n, { type: s.type, default: s.default, hint: s.hint }])) : undefined }]));
}

module.exports = { SCHEMA, settable, leaf, value, leaves, describe };

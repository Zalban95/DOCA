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
  // Proposable for one screen too (deep test A, 2026-10-08): a screen that ever picked its colours keeps its own, so a
  // hive proposal of "light" changed nothing the person could see. A look, never a guard.
  theme:            { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'colour theme', propose: p('Theme') },
  customTheme:      { is: 'travels', home: 'device', on: 'screen', note: 'a theme the person made', propose: p('Custom theme colours') },
  skin:             { is: 'travels', home: 'device', on: 'screen', note: 'the panel skin' },
  lookThemes:       { is: 'travels', home: 'device', on: 'screen', note: 'the colours last chosen for each look, {skin: theme}, put back when the look is chosen again (settings/appearance.js)' },
  hiddenTabs:       { is: 'travels', home: 'device', on: 'screen', note: 'which tabs are hidden', propose: p('Navigation visibility') },
  codeExpanded:     { is: 'travels', home: 'device', on: 'screen', note: 'a UI fold state' },
  sidebarStats:     { is: 'travels', home: 'device', on: 'host', note: 'which stats the host collects for the sidebar (the collectors run here, for every screen)', propose: p('Sidebar stats', 'Which stats the sidebar shows') },
  sidebarSections:  { is: 'travels', home: 'device', on: 'screen', note: 'which sidebar sections are open', propose: p('Sidebar sections') },
  favorites:        { is: 'travels', home: 'device', on: 'screen', note: 'favourite config files, by registry id', propose: p('Config favourites') },
  voice:            { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'the voice this screen is answered in: engine (a speech service of the Services tab, empty = the hive\'s; tts-engines.js), ttsVoice and ttsSpeed, over voiceServices (chat.js handleSynthesize); and a voice per kind of call, quick (the Live call: the face, a device\'s call), deep (the chat\'s 🎙) and ambient (Ambient\'s assistant; unset, it is the quick voice), each {service, voice, speed}, read from the screen, its person, then the hive (call-voices.js; Settings → Voice, one Voice card)' },
  call:             { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'how a live call listens on this screen — its microphone is its own (chat-call.js; Settings → Voice → Live call)',
    keys: {
      silenceMs:   { type: 'integer', min: 300, max: 10000, default: 2000, hint: 'How long a pause, in milliseconds, ends what you said and sends it. A device\'s call (a watch\'s) reads it too, from the device\'s own page; unset there, 1400 (realtime/call-pause.js).' },
      sensitivity: { type: 'integer', min: 1, default: 15, hint: 'The microphone level that counts as speech; lower hears quieter voices and more of the room.' },
      assistantIdleSec: { type: 'integer', min: 5, default: 12, hint: 'In the Live call (the face tapped) and Ambient\'s assistant, seconds of quiet before it goes back to waiting for the wake word, where the screen listens for one.' },
      listenWithFace: { type: 'boolean', default: false, hint: 'While the corner face shows, listen for the wake word and start a call when it is said (experiments.wakeWord).' },
      wakeWord: { type: 'string', default: '', hint: 'The word that starts a call. Empty: the product\'s name (branding).' },
      language: { type: 'string', default: '', hint: 'The language spoken in a call on this screen, as a two-letter code (en, it…): the transcriber is told it instead of guessing. Empty: the person\'s usual language, from what they write and say.' },
      // Whether the microphone may stay open with the page in the background (public/js/lib/mic-keep.js). The person's
      // own switch beside the chats, never proposable: an agent keeping a microphone open is not a look to suggest.
      micAlways: { type: 'boolean', default: false, propose: false, hint: 'Let the microphone stay open with the app in the background: the wake word keeps listening and a call keeps going. Off: it opens only for a call or a recording, and closes when the page is hidden.' },
    } },
  ambient:          { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'the ambient screen (public/js/ambient.js): where it is for the weather, its quick buttons, whether it listens for its name — `buttons` is a list of {label, say} (what the button says to the agent), `show` which parts are drawn (clock, weather, plan, notices, buttons, apps: false hides one), `here` the device\'s own position the page last found ({lat, lon, name, at}; ambient-where.js), used when no place is named',
    keys: {
      place:  { type: 'string', default: '', hint: 'Where this screen is, for the weather: a town, or "lat,lon". Empty: this device\'s own location (with auto), else no weather.' },
      units:  { type: 'string', default: 'metric', hint: 'metric (°C, km/h) or imperial (°F, mph).' },
      listen: { type: 'boolean', default: true, hint: 'While the ambient screen rests, listen for the wake word (experiments.wakeWord); a call or a recording takes the microphone when it needs it.' },
      clock24: { type: 'boolean', default: true, hint: 'A 24-hour clock.' },
      auto:    { type: 'boolean', default: true, hint: 'With no place named, use this device\'s own location (the browser asks once).' },
      margin:  { type: 'integer', min: 0, max: 25, default: 7, hint: 'Side margins, % of the screen\'s width.' },
      marginY: { type: 'integer', min: 0, max: 25, default: 6, hint: 'Top and bottom margins, % of the screen\'s height.' },
    } },
  face:             { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'the face: its look, a spec over the default (face/face.js); an edition carries one' },
  panel:            { is: 'travels', home: 'device', on: 'screen', screenPropose: true, note: 'the panel\'s structure as data (modules/panel-layout): groups and their pages in order, hidden and renamed pages, a person\'s own views made of pages, and style (font scale, density, theme tokens) — layered install → person → screen, edited with the panel_layout tool' },
  hiddenBuiltins:   { is: 'travels', home: 'device', on: 'screen', note: 'built-in config entries hidden from the list', propose: p('Hidden built-ins') },

  // ── The hive: how its agents behave and what they may do ──
  branding:         { is: 'travels', home: 'hive', note: 'the name and look the panel wears' },
  updates:          { is: 'travels', home: 'hive', note: 'how updates are offered',
    keys: { repo: { type: 'string', default: '', hint: 'owner/name on GitHub that the update check reads when git cannot (an edition or a fork). Empty: the DOCA project.' },
      // A production hive's update channel (update-channel/): never proposable, as the section is not — the owner's.
      auto: { type: 'string', oneOf: ['off', 'notify', 'window'], default: 'notify', hint: 'A production hive\'s updates: off (only when asked), notify (say a release is ready; install it with Update now), or window (install it inside the update window). Running work is never cut, and an urgent release is applied after its date whatever this says.' },
      days: { type: 'array', default: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], hint: 'The days of the update window (sun, mon, tue, wed, thu, fri, sat).' },
      from: { type: 'string', default: '02:00', hint: 'When the update window opens, HH:MM on this hive\'s clock.' },
      to: { type: 'string', default: '05:00', hint: 'When it closes, HH:MM; earlier than from runs past midnight. An update still waiting for running work when it closes waits for the next window.' } } },
  agents:           { is: 'travels', home: 'hive', note: 'whether specialists are switched on',
    propose: p('Specialist agents', 'Allow the orchestrator to dispatch specialists', { prefix: 'agents.enabled', exact: true }) },
  // No box in the panel on purpose: a note is the agent's proposal about a tool, and its Accept is the control.
  toolNotes:        { is: 'travels', home: 'hive', note: 'notes added to tool descriptions (fingerprinted per tool)',
    propose: p('Tool note', 'Added to the tool\'s description — what the agent reads when it picks the tool') },
  // Which instructions go with every turn is the person's choice, not the agent's: not proposable (skill-use.js).
  skillUse:         { is: 'travels', home: 'hive', note: 'how each skill is used, by name: {use: fits | attached | off, modes: [agent, plan, ask, debug], where: any | project, triggers: [words]} — absent, the skill\'s own front matter, else "when it fits" (harness/skill-use.js; Settings → Harness → Skills)' },
  skillSuggest:     { is: 'travels', home: 'hive', note: 'skills a message names by a trigger word (harness/skill-triggers.js, skill-next.js)',
    keys: { autoAccept: { type: 'boolean', default: false, propose: false, hint: 'Attach a skill a message names by one of its triggers without asking (a chat may say otherwise; a project chat in Agent mode does by default). Off: the composer suggests it and a tap attaches it.' } } },
  // Numbers only, and deliberately a different key from `mcpServers`, which holds commands this host spawns
  // and stays out of reach. settings.sectionFor matches a whole prefix, so one can never open the other.
  mcpSettings:      { is: 'travels', home: 'hive', note: 'MCP timeouts', propose: p('MCP timeouts', 'How long to wait for an MCP tool before giving up'),
    keys: {
      callTimeoutMs: { type: 'integer', min: 1000, default: 120000, hint: 'How long a single MCP tool call may take (an agents\' computer has its own, computers.callTimeoutMs). It stops the waiting, not the work.' },
      listTimeoutMs: { type: 'integer', min: 1000, default: 20000, hint: 'How long to wait for a server to list its tools when it starts.' },
    } },
  computers:        { is: 'travels', home: 'hive', note: 'limits on agents\' computers: how many run, when they stop and are removed',
    propose: p('Agents\' computers', 'How many run at once, when they stop and when they are removed'),
    keys: {
      maxRunning:      { type: 'integer', min: 0, default: 4, hint: 'How many agents\' computers may run at once.' },
      idleStopMinutes: { type: 'number', min: 0, default: 10, hint: 'Minutes after its mission ends that a computer stops (its files stay).' },
      retainHours:     { type: 'number', min: 0, default: 72, hint: 'Hours a stopped computer an agent made is kept before it is removed with its files; a pinned one is kept.' },
      callTimeoutMs:   { type: 'integer', min: 1000, default: 600000, hint: 'How long one call to a computer\'s tools may take before the agent stops waiting (the work goes on); longer than other MCP servers\' mcpSettings.callTimeoutMs, for installs, builds and sweeps.' },
      // Never proposed: an agent choosing what is deleted of what no record names (computers/strays.js; the owner's, 2026-10-08).
      strays:          { type: 'string', oneOf: ['leave', 'archive', 'delete'], default: 'leave', propose: false,
        hint: 'What the tidy-up does with a stopped computer container no record names and no install labels: leave it (listed in the Computers tab), archive it, or delete it (its files kept in its volume).' },
    } },
  // Where the Home page reads a home from (modules/home; docs/design/home-node.md). The owner's: not proposable.
  home:             { is: 'travels', home: 'hive', note: 'where the Home page and the agent read Home Assistant from: the hub itself (the key home-assistant) or home nodes in the households',
    keys: {
      source: { type: 'string', oneOf: ['auto', 'node', 'direct', 'both'], default: 'auto', propose: false,
        hint: 'auto — home nodes when any is paired (always on a hosted hive), else the hub itself with the key home-assistant; node — home nodes only; direct — the hub itself only; both — every home.' },
    } },
  // Housekeeping, not a guard: proposable like computers.idleStopMinutes (agents/tidy.js). 0 turns a rule off.
  missions:         { is: 'travels', home: 'hive', note: 'when finished specialists\' missions are put away in the Archive by themselves',
    propose: p('Finished missions', 'When finished missions are put away in the Archive by themselves'),
    keys: {
      archiveSeenAfterMin: { type: 'number', min: 0, default: 30, hint: 'Minutes after its person opened a finished mission that it is put away in the Archive (0: never by this rule).' },
      archiveAfterHours:   { type: 'number', min: 0, default: 24, hint: 'Hours after a mission finished that it is put away, seen or not (0: never by this rule). One its leader has not read, one waiting for a person, or one kept with 📌 stays.' },
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
      releaseUnasked: { type: 'array', default: [], hint: 'Empty on a new install: no model releases unasked until the owner lists one (CONSTITUTION §0 — whom to trust is the owner\'s choice). Models that may merge, tag, push and switch the live panel without asking (CONSTITUTION W2), a family each, optionally with a minimum version. Empty: everyone asks.' } } },
  // Experiments (hive.md §8): off by default, each written up in docs/experiments/<id>.md. The owner's switch alone —
  // never proposable: an agent switching on its own experiments would be grading its own homework.
  experiments:      { is: 'travels', home: 'hive', note: 'experiments switched on (docs/experiments)',
    keys: { recipeRepair: { type: 'boolean', default: false, hint: 'When a recipe fails, the agent investigates and proposes a repaired revision for a person to accept.' },
      retrieval: { type: 'boolean', default: false, hint: 'memory_search and recall_conversations also search by meaning, with the embedding model under retrieval.' },
      library: { type: 'boolean', default: false, hint: 'The Library: the folders chosen under library are indexed by meaning — documents, pictures, sound and video — and searched from Files and by library_search.' },
      bargeIn: { type: 'boolean', default: false, hint: 'In a voice call, speaking while the agent works or talks is sent at once, and what it was about to say is dropped.' },
      realtimeVoice: { type: 'boolean', default: false, hint: 'A live call speaks with a realtime speech model (realtime.*) in place of speech-to-text, a turn and text-to-speech; the model hands real work to the hive.' },
      faceVoice: { type: 'boolean', default: false, hint: 'In a voice call, the corner face moves its mouth with the agent\'s voice and listens when you speak.' },
      wakeWord: { type: 'boolean', default: false, hint: 'A screen showing the corner face listens for the wake word (call.wakeWord) and starts a call when it hears it.' },
      wakeModel: { type: 'boolean', default: false, hint: 'Where a model trained for the wake word is kept (Field → Models → Wake words), a listening screen hears the word with it, on the screen itself, instead of sending sound to speech-to-text.' },
      packRegistry: { type: 'boolean', default: false, hint: 'This hub lists the packs a host published to hubs holding a registry token, and can fetch from other hubs\' registries.' },
      modelScout: { type: 'boolean', default: false, hint: 'The model scout: looks for better and new models, files suggestions a person accepts into TODO and hands to an implementer.' },
      visionPass: { type: 'boolean', default: false, hint: 'Agents may look at a computer\'s screen with the vision model under vision.' },
      claimCheck: { type: 'boolean', default: false, hint: 'When an answer says it saved a memory, set a reminder, proposed, committed or sent something that no call this turn did, the turn gets one more step to do it or say it was not done.' },
      toolTiers: { type: 'boolean', default: false, hint: 'The Orchestrator and work chats are sent their core tools in full and the rest by name, loaded when needed (tools_more).' },
      riskTiers: { type: 'boolean', default: false, hint: 'Each tool call is read, reversible or outward: reversible changes in a project run after a checkpoint, and outward ones (deleting outside a project, a force-push, mail, a request sending data out) are asked in every mode, Unattended included.' },
      adaptiveLimits: { type: 'boolean', default: false, hint: 'Before a turn, a triage rates the request and sets its thinking effort and step budget (never under Max tool steps); a turn still advancing at its last step is extended up to limits.maxStepsCeiling.' },
      systemOne: { type: 'boolean', default: false, hint: 'A System 1 decision model (Laya, run on this hub, or TypeSafe Jev) answers bounded decisions — the triage\'s size, a call\'s answer-now-or-hand-on, a computer\'s next element (computer_next) — and today\'s way decides whenever it is unsure (systemOne.threshold).' } } },
  // The owner's ceiling on how far a turn's steps may follow the work (experiment adaptiveLimits, turn/triage.js). Not
  // proposable: an agent raising the bound on its own turns would be writing its own limit (CONSTITUTION P20).
  limits:           { is: 'travels', home: 'hive', note: 'the ceiling adaptive step budgets and extensions stay under (turn/triage.js, turn/extend.js; the switch is experiments.adaptiveLimits)',
    keys: { maxStepsCeiling: { type: 'integer', min: 1, max: 1000, default: 64, hint: 'The most tool steps one turn may reach when its budget follows the work (experiment adaptiveLimits). Below Max tool steps it changes nothing: a budget is never under that.' } } },
  assistant:        { is: 'travels', home: 'hive', note: 'assistant mode: a call started from the face answers quicker and shorter, in its own style (turn/effort.js, turn/client.js)',
    propose: p('Live call', 'How the face (and Ambient\'s assistant) answers when spoken to: its style, thinking effort and model'),
    keys: { effort: { type: 'string', default: 'low', hint: 'Thinking effort in assistant mode: off, low, medium, high, or default (send nothing: the model\'s own).' },
      style: { type: 'string', default: 'You are the hive\'s voice, spoken to through its face — a companion who handles things. Answer in one to three short spoken sentences: direct, warm, conversational. No lists, no markdown, nothing read out that belongs on a screen. When something takes work, say in a few words what you are doing and do it; offer to go deeper rather than going deep.',
        hint: 'How assistant mode speaks — the instruction every face-started turn is given.' },
      reply: { type: 'string', default: 'act', hint: 'In a call, a clear request with a visible result: act (do it, answer only ✓ — nothing spoken), brief (a few words) or always (say what was done).' },
      calls: { type: 'boolean', default: false, hint: 'Use this effort and model for the chat\'s 🎙 call too, not only for the face.' },
      front: { type: 'boolean', default: true, hint: 'A call answers at once with a short kit of quick actions, and hands anything bigger — or anything you ask it to think harder about — to a work chat, whose outcome it says in the call. Off: a spoken turn holds every tool, as before.' },
      provider: { type: 'string', default: '', hint: 'A provider for assistant mode\'s own model. Empty: the conversation\'s.' },
      model: { type: 'string', default: '', hint: 'A quicker model for assistant mode (e.g. a small local one). Empty: the conversation\'s model.' } } },
  // Whether each kind of conversation thinks (turn/thinking.js; Settings → Harness → Thinking). A preference, not a guard.
  thinking:         { is: 'travels', home: 'hive', note: 'thinking per mode: auto, off, or a level (turn/thinking.js); a conversation\'s 💭 toggle and "think harder" still win',
    propose: p('Thinking', 'Whether each kind of conversation thinks before it answers: chat, work chats, specialists, the calls, Ambient, devices'),
    keys: Object.fromEntries([['chat', 'The Orchestrator and the conversations you start'], ['work', 'Work chats (and a project\'s tabs)'], ['specialist', 'Specialists\' missions'],
      ['liveCall', 'The Live call (the face; auto: assistant.effort)'], ['deepCall', 'The Deep call (the chat\'s 🎙)'], ['ambient', 'Talking to the ambient screen'],
      ['device', 'A paired device\'s call (the watch)']].map(([k, what]) => [k, { type: 'string', oneOf: ['auto', 'off', 'low', 'medium', 'high'], default: 'auto',
      hint: `${what}: auto (as before — the triage, assistant mode's effort, the harness's), off (no thinking), or on at low, medium or high.` }])) },
  setup:            { is: 'local', home: 'device', on: 'host', note: 'how this hub was set up and what shape it is (guided/plan.js; CONSTITUTION §1 "Two shapes, two set-ups") — the owner\'s, never proposable',
    keys: { mode: { type: 'string', default: '', hint: 'guided or advanced: the owner\'s first-run choice. Empty: not chosen yet, so the panel offers it once.' },
      shape: { type: 'string', default: '', hint: 'local (runs its own agent model) or preset (lives on providers\' keys), as the guided set-up found this machine.' } } },
  sharing:          { is: 'local', home: 'hive', note: 'whether what the agents learn (skills, recipes, specialists kept as packs) may be offered to the project, and to which hub — asked at installation, the owner\'s alone, never proposable (sharing.js; CONSTITUTION §0)',
    keys: {
      contribute: { type: 'boolean', default: false, hint: 'Offer the skills, recipes and specialists your agents learn to the project. Nothing is sent without your click.' },
      upstream:   { type: 'string', default: '', hint: 'The project\'s hub that receives them: one of the hubs this hive sends packs to.' },
    } },
  features:         { is: 'travels', home: 'hive', note: 'the feature index (features/): which kept alternatives the admin hid from the default, and when one counts as unused — the admin\'s decision, never proposable (CONSTITUTION W14)',
    keys: {
      hidden:          { type: 'array', default: [], hint: 'Alternatives hidden from the default: they keep working and the agents still find them.' },
      idleDays:        { type: 'number', min: 1, default: 30, hint: 'Days without a use before an alternative is listed as unused.' },
      replacementRuns: { type: 'number', min: 1, default: 50, hint: 'Uses of the feature it stands beside, in that time, before it is listed as unused.' },
    } },
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
      retainDays: { type: 'number', min: 1, max: 3650, default: 30, hint: 'Days a turn\'s trace is kept.' },
      maxSpans: { type: 'integer', min: 1000, max: 10000000, default: 100000, hint: 'The most trace rows kept (a few hundred bytes each); past it the oldest go first.' } } },
  retrieval:        { is: 'travels', home: 'hive', note: 'the embedding model retrieval uses (retrieval/; the switch is experiments.retrieval)',
    propose: p('Retrieval', 'Which embedding model searches memory and conversations by meaning'),
    keys: { provider: { type: 'string', default: 'ollama', hint: 'The provider that serves the embedding model (Field → API keys); ollama by default.' },
      model: { type: 'string', default: '', hint: 'An embedding model, e.g. nomic-embed-text or bge-m3 on Ollama. Empty: retrieval stays off.' } } },
  // The Library (experiment library; docs/experiments/library.md): which folders of this machine are indexed and who may
  // search them — what is read and whom it is opened to are the owner's, so none of it is proposable.
  library:          { is: 'local', home: 'device', on: 'host', note: 'the Library: the embedding model, the folders of this machine it indexes, who may search them, and when (library/)',
    keys: { provider: { type: 'string', default: 'ollama', hint: 'The provider that serves the embedding model (Field → API keys); ollama by default.' },
      model: { type: 'string', default: '', hint: 'A multimodal embedding model, e.g. embeddinggemma-2:740m on Ollama. Empty: nothing is indexed.' },
      dialect: { type: 'string', oneOf: ['ollama', 'openai'], default: 'ollama', hint: 'ollama: /api/embed, which takes pictures and sound; openai: /embeddings, text only.' },
      folders: { type: 'array', default: [], hint: 'Folders to index, inside the Files tab\'s roots.' },
      open: { type: 'array', default: [], hint: 'Of those folders, the ones every person who may chat can search (a host searches all).' },
      kinds: { type: 'array', default: ['documents', 'images', 'audio', 'video'], hint: 'What to index: documents, images, audio, video.' },
      when: { type: 'string', oneOf: ['demand', 'schedule', 'watch'], default: 'demand', hint: 'demand: when asked; schedule: every everyHours; watch: while the panel is open, when a folder changes.' },
      everyHours: { type: 'number', min: 1, max: 720, default: 24, hint: 'On a schedule, hours between runs.' },
      maxFiles: { type: 'integer', min: 10, max: 1000000, default: 20000, hint: 'The most files indexed; past it the rest are counted, not read.' },
      maxPieces: { type: 'integer', min: 100, max: 2000000, default: 100000, hint: 'The most pieces (vectors) kept, about 3 KB each in memory while searching.' },
      frameEverySec: { type: 'number', min: 1, max: 600, default: 10, hint: 'For video, seconds between the frames indexed (at most 32 a video).' },
      transcribe: { type: 'boolean', default: true, hint: 'Transcribe audio and video with the hub\'s speech-to-text, so their words are searched with their times.' },
      maxFileMB: { type: 'number', min: 1, max: 100000, default: 2000, hint: 'Files larger than this are listed, not read.' },
      idleLoad: { type: 'number', min: 0.1, max: 64, default: 0.8, hint: 'Indexing waits while the machine\'s load per core is above this.' },
      tags: { type: 'array', default: [], hint: 'Tags of your own, added to the shipped vocabulary (library/tags.json) that files are labelled with.' },
      tagMargin: { type: 'number', min: 0, max: 1, default: 0.06, hint: 'How far above the file\'s average tag score a tag must be to be kept.' },
      captions: { type: 'boolean', default: false, hint: 'Write a one-line caption for pictures and video frames with the vision model (vision.model): a model call per file.' },
      captionsPerRun: { type: 'integer', min: 1, max: 100000, default: 200, hint: 'The most captions written in one run.' } } },
  migrations:       { is: 'travels', home: 'hive', note: 'which prefs migrations this file has had, and what they changed (migrations.js) — the record travels with the file' },
  usagePrices:      { is: 'travels', home: 'hive', note: 'the owner\'s price list for the usage window (harness/prices.js)' },
  // No box in the panel on purpose: learned by harness/contracts.js from a provider's refusals; the file is where an
  // expert corrects one, and a form would invite guessing at a provider's quirks.
  providerContracts: { is: 'mixed', home: 'hive', note: 'the owner\'s corrections to what a provider accepts (harness/contracts.js): about a remote provider they travel, about a server on this machine they are local' },
  harness:          { is: 'mixed', home: 'hive', note: 'config (model, limits, fallback chain, prompts), the guards\' settings and approval mode travel (the guard model files are local, in the data folder); the always-allowed list names commands of this machine and is local. Provider keys are not here: they live in the data folder (keys/).',
    propose: [p('Harness parameters', 'Includes this agent\'s own model and behaviour', { prefix: 'harness.config' }),
      p('Default harness', 'Which runtime the chat panel talks to', { prefix: 'harness.default' })],
    keys: {
      // Never proposed: how long a person is given to answer for a mission's use of a machine (harness/mission-asks.js).
      'approval.missionAskSec': { type: 'integer', min: 10, max: 900, default: 300, propose: false,
        hint: 'Seconds a mission\'s question to use a machine (a VNC screen, a sign-in on its computer) is pressed on its person\'s devices; then it is held or denied (missionAskTimeout).' },
      // Never proposed: what Manual asks (harness/approval-matters.js). A safety switch — guarded by the password with the
      // mode (auth/guarded.js). A new install asks what matters; an install from before keeps everything (migration 2.331-manual-asks).
      'approval.manualAsks': { type: 'string', oneOf: ['everything', 'what-matters'], default: 'what-matters', propose: false,
        hint: 'What Manual approval asks about: everything that does something, or only what matters — what cannot be undone or leaves this machine (sending data out, posting, mail, pushing, paying, deleting outside a project, a command it cannot read).' },
      // Never proposed either: what an unanswered machine question becomes — hold (it stays open, the mission waits) or deny.
      'approval.missionAskTimeout': { type: 'string', oneOf: ['hold', 'deny'], default: 'hold', propose: false,
        hint: 'When nobody answers a mission\'s machine question in time: hold — the question stays open in Harness → Approvals and the mission waits, paused, until someone answers — or deny.' },
    } },
  models:           { is: 'mixed', home: 'hive', note: 'preferences travel; runtime URLs name this machine. The Hugging Face token is in the protected keys (hf-token.js), never here',
    propose: p('Model manager', 'Ollama URL, download directories') },

  // ── The machine DOCA runs on ──
  paths:            { is: 'local', home: 'device', on: 'host', note: 'folders and URLs of this machine (paths.js SETTABLE)', propose: p('Managed paths', 'Applies after a restart of the panel') },
  fmFavorites:      { is: 'local', home: 'device', on: 'host', note: 'favourite folders: paths of this machine', propose: p('File manager favourites') },
  llamacpp:         { is: 'local', home: 'device', on: 'host', note: 'binary paths and server instances',
    keys: { discovery: { type: 'string', default: 'servers', hint: 'How the Models tab finds llama-servers DOCA did not start: servers (model-servers.js, the default) or props (each one\'s /props, kept beside it).' },
      modelsDir: { type: 'string', default: '', hint: 'Where GGUF files from Hugging Face are kept (Field → Models → llama.cpp → From Hugging Face); empty is models/gguf in your home folder.' } } },
  serviceSettings:  { is: 'local', home: 'device', on: 'host', note: 'ports and URLs of services on this machine', propose: p('Inference services', 'GPU assignment, ports, images') },
  // When the inference services and llama.cpp servers DOCA started are stopped by DOCA (modules/service-life). Never
  // proposable: an agent switching services off under the person, or keeping them on, is the person's call. `each` holds
  // one row's own choices by `<kind>:<id>` ({idleStopMinutes: null = the switch's, stopWithDoca, startWhenNeeded}).
  services:         { is: 'local', home: 'device', on: 'host', note: 'when DOCA stops the services it started: after idle minutes, and when DOCA itself stops (service-life/)',
    keys: {
      idleStopMinutes: { type: 'number', min: 0, max: 10080, default: 0, hint: 'Stop a service DOCA started when nothing has used it for this many minutes, counted only while no page of the panel is open and no call is on (0: never).' },
      stopWithDoca:    { type: 'boolean', default: false, hint: 'When DOCA itself stops (shut down, or stopped by its launcher or the system) — not a browser tab closing, not a restart or a version switch — stop the services it started that are ticked.' },
    } },
  voiceServices:    { is: 'local', home: 'device', on: 'host', note: 'speech services on this machine or the tailnet', propose: p('Voice services') },
  snapshotSettings: { is: 'local', home: 'device', on: 'host', note: 'where snapshots of this machine go', propose: p('Snapshot settings') },
  mcpServers:       { is: 'local', home: 'device', on: 'host', note: 'spawnable commands and URLs — never proposed, never exported' },
  dockerPresets:    { is: 'local', home: 'device', on: 'host', note: 'compose presets for this machine\'s Docker' },
  clientApps:       { is: 'local', home: 'device', on: 'host', note: 'where DOCA\'s Android apps\' repositories are on this machine, to build them (client-apps/)' },
  backup:           { is: 'local', home: 'device', on: 'host', note: 'the backup schedule of this machine',
    // A second copy of every backup on another disk (backup/mirror.js). A path on this machine: never the agent's to propose.
    keys: { mirror: { type: 'string', default: '', propose: false, hint: 'A second folder on this machine (another disk, a NAS mount) where every backup is also copied, keeping as many scheduled ones as here. Empty: none.' } } },
  // The System 1 decision model (experiment systemOne, modules/system-one). Not proposable: its threshold decides when a
  // model's guess replaces a rule, and its service runs on this machine.
  systemOne:        { is: 'local', home: 'device', on: 'host', note: 'the System 1 decision model: which one, where it runs on this machine, how sure it must be (modules/system-one; the switch is experiments.systemOne)',
    keys: { provider: { type: 'string', oneOf: ['laya', 'jev'], default: 'laya', hint: 'laya — the open Laya model, run by this hub (Field → Models → Decision models) — or jev, TypeSafe\'s API with the key for services named in jevKey.' },
      threshold: { type: 'number', min: 0, max: 1, default: 0.6, hint: 'How sure the model must be — the probability it gives its top choice, 0–1 — for its answer to be used; below it, today\'s way decides.' },
      port: { type: 'integer', min: 1024, max: 65535, default: 8791, hint: 'The port Laya\'s service listens on, on this machine only (127.0.0.1).' },
      device: { type: 'string', oneOf: ['auto', 'cpu', 'cuda', 'mps'], default: 'auto', hint: 'Where Laya computes: auto (a GPU when there is one), cpu or cuda.' },
      checkpoint: { type: 'string', oneOf: ['english', 'multilingual'], default: 'english', hint: 'Laya\'s checkpoint: english (ModernBERT-large) or multilingual (mmBERT-base, 100+ languages).' },
      autostart: { type: 'boolean', default: false, hint: 'Start Laya\'s service when DOCA starts (once it is set up).' },
      dir: { type: 'string', default: '', hint: 'Where Laya\'s Python environment lives (1–6 GB with PyTorch: more with CUDA). Empty: the data folder\'s system-one/.' },
      jevKey: { type: 'string', default: 'typesafe', hint: 'The key for services (Field → Connectors) that holds a TypeSafe API key, for the jev provider.' },
      jevVersion: { type: 'string', default: 'jev-latest', hint: 'Which Jev the jev provider asks for: jev-latest, jev-preview or a pinned version such as jev-1.13.0.' } } },
  wakeword:         { is: 'local', home: 'device', on: 'host', note: 'where wake-word training keeps its environment, data (~20 GB) and models (wakeword/)',
    keys: { dir: { type: 'string', default: '', hint: 'A folder for wake-word training (about 20 GB). Empty: the data folder\'s wakeword/.' } } },
  network:          { is: 'local', home: 'device', on: 'host', note: 'how this machine listens, and what may be done from outside the tailnet (network.js)',
    keys: { listen: { type: 'string', default: 'tailnet', hint: 'tailnet (Tailscale and this machine), lan (also the local network), local (this machine only), all (every interface). From the next start.' },
      lanAdmin: { type: 'boolean', default: false, hint: 'Allow managing the machine (admin rights) from outside Tailscale. Off: from the local network a person reads and chats.' },
      services: { type: 'string', default: 'local', hint: 'Where the inference services this hub starts (Whisper, Kokoro, ComfyUI…) can be reached: local (this machine only — the hub reaches them here), tailnet (also its Tailscale address), all (every interface, the local network included, with no sign-in). From each service\'s next start.' } } },
  // The licence (modules/license): where this hive checks in, and how long a lapsed licence keeps working. Addresses,
  // not secrets — the key lives in keys/licence.json. Never proposable: what the hive may run is the owner's.
  licence:          { is: 'local', home: 'device', on: 'host', note: 'the licence server this hive checks in with, and the grace after a missed check-in (license/; Settings → System → Licence)',
    keys: { server: { type: 'string', default: '', hint: 'The licence server\'s address (https://…). Empty: offline — renew by uploading a licence file.' },
      account: { type: 'string', default: '', hint: 'The licence server\'s account id (Keygen). Empty: its only account.' },
      graceDays: { type: 'integer', min: 0, max: 90, default: 14, hint: 'Days a licence that lapsed (expired, or not checked in) keeps working before licensed features turn read-only; never longer than the licence allows.' } } },
  // What is kept of what happened (log-keep.js; Settings → System → Logs; CONSTITUTION §1: nothing unseen, but the log
  // never fills memory or disk needlessly). Sized for a small machine. Never proposable: a retention an agent could
  // shorten is one that could erase the record of what agents did.
  logs:             { is: 'local', home: 'device', on: 'host', note: 'what the hub keeps of what happened, how much and for how long: the log lines in memory, run records, background jobs, evaluation results (log-keep.js)',
    keys: {
      harnessLines:    { type: 'integer', min: 50, max: 20000, default: 500, hint: 'Lines of the harness log (Hub → Logs) kept in memory since the last start.' },
      workstreamLines: { type: 'integer', min: 50, max: 5000, default: 300, hint: 'Lines of the Workstream\'s activity kept in memory.' },
      mcpLines:        { type: 'integer', min: 20, max: 5000, default: 200, hint: 'Lines of each MCP server\'s own output kept in memory.' },
      callLines:       { type: 'integer', min: 50, max: 5000, default: 500, hint: 'Lines of the live calls\' log (Hub → Logs, source call) kept in memory: each stage of each call, in names and numbers; also kept on disk for callDays and read back at start.' },
      callDays:        { type: 'number', min: 1, max: 365, default: 7, hint: 'Days the live calls\' log is kept on disk (DATA_DIR/calls), so a restart or a version switch does not wipe it.' },
      machinesLines:   { type: 'integer', min: 50, max: 5000, default: 500, hint: 'Lines of the machines\' log (Hub → Logs, source machines) kept in memory: started, stopped, busy, idle, processes started outside DOCA\'s tools.' },
      runsRetainDays:  { type: 'number', min: 1, max: 3650, default: 90, hint: 'Days the record of each turn, mission and device job is kept (Chronicle reads them); its trace goes with it.' },
      jobsKept:        { type: 'integer', min: 5, max: 1000, default: 50, hint: 'Background jobs (shell_job) kept with their output files; the oldest finished ones go first.' },
      evalResultsKept: { type: 'integer', min: 1, max: 500, default: 30, hint: 'Results kept per evaluation set, to compare a run with the one before.' },
      activityDays:    { type: 'number', min: 1, max: 3650, default: 30, hint: 'Days the record of what the hub did on its own (a computer tidied away, a server resumed, a schedule fired) is kept (Chronicle → What the hub did).' },
    } },
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

/** The screen keys the agent may propose for one screen (`screenPropose`; harness/screen-proposals.js, TODO C2). */
function screenSettable() { return Object.entries(SCHEMA).filter(([, d]) => d.screenPropose && d.on === 'screen').map(([k]) => k); }

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
  if (spec.type === 'string') return typeof v === 'string' && (!spec.oneOf || spec.oneOf.includes(v));
  if (spec.type === 'array') return Array.isArray(v) && v.every(x => typeof x === 'string');
  return true;
}

/**
 * A leaf the agent never proposes (`propose: false`) at this path, or inside the value given for it — `computers`
 * set whole as {strays: …} is the same change as `computers.strays`. Its path, or null.
 */
function unproposable(dotted, value) {
  const [top, ...rest] = String(dotted).split('.');
  const at = rest.join('.');
  for (const [k, spec] of Object.entries(SCHEMA[top]?.keys || {})) {
    if (spec.propose !== false) continue;
    if (k === at) return `${top}.${k}`;
    if (at && !k.startsWith(`${at}.`)) continue;
    const inside = (at ? k.slice(at.length + 1) : k).split('.').reduce((o, x) => (o == null || typeof o !== 'object' ? undefined : o[x]), value);
    if (inside !== undefined) return `${top}.${k}`;
  }
  return null;
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

module.exports = { SCHEMA, settable, screenSettable, leaf, valid, value, leaves, describe, unproposable };

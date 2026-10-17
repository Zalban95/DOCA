'use strict';

/**
 * The declaration of prefs `experiments` (settings-schema.js reads it from here, beside experiments.js, which lists
 * them): one boolean per experiment, off by default, each written up in docs/experiments/<id>.md (hive.md §8). The
 * owner's switch alone — never proposable: an agent switching on its own experiments would be grading its own homework.
 */
module.exports = { is: 'travels', home: 'hive', note: 'experiments switched on (docs/experiments)',
    keys: { recipeRepair: { type: 'boolean', default: false, hint: 'When a recipe fails, the agent investigates and proposes a repaired revision for a person to accept.' },
      retrieval: { type: 'boolean', default: false, hint: 'memory_search and recall_conversations also search by meaning, with the embedding model under retrieval.' },
      retrievalRerank: { type: 'boolean', default: false, hint: 'With retrieval on, a search is also run in two or three rewordings from assistant mode\'s quick model, and the merged results are read again by the reranker under retrieval.rerankModel.' },
      library: { type: 'boolean', default: false, hint: 'The Library: the folders chosen under library are indexed by meaning — documents, pictures, sound and video — and searched from Files and by library_search.' },
      bargeIn: { type: 'boolean', default: false, hint: 'In a voice call, speaking while the agent works or talks is sent at once, and what it was about to say is dropped.' },
      realtimeVoice: { type: 'boolean', default: false, hint: 'A live call speaks with a realtime speech model (realtime.*) in place of speech-to-text, a turn and text-to-speech; the model hands real work to the hive.' },
      wakeModel: { type: 'boolean', default: false, hint: 'Where a model trained for the wake word is kept (Field → Models → Wake words), a listening screen hears the word with it, on the screen itself, instead of sending sound to speech-to-text.' },
      packRegistry: { type: 'boolean', default: false, hint: 'This hub lists the packs a host published to hubs holding a registry token, and can fetch from other hubs\' registries.' },
      visionPass: { type: 'boolean', default: false, hint: 'Agents may look at a computer\'s screen with the vision model under vision.' },
      promptCache: { type: 'boolean', default: false, hint: 'Mark the system prompt and the newest message as cache breakpoints for Anthropic\'s models (through OpenRouter or Anthropic), which otherwise re-read the whole prompt at full price on every step. Changes no word the model reads.' },
      claimCheck: { type: 'boolean', default: false, hint: 'When an answer says it saved a memory, set a reminder, proposed, committed or sent something that no call this turn did, the turn gets one more step to do it or say it was not done.' },
      riskTiers: { type: 'boolean', default: false, hint: 'Each tool call is read, reversible or outward: reversible changes in a project run after a checkpoint, and outward ones (deleting outside a project, a force-push, mail, a request sending data out) are asked in every mode, Unattended included.' },
      alwaysFree: { type: 'boolean', default: false, hint: 'The main chat stays free: a clear job goes to a work chat before any model is asked, with a fixed line naming it; any other real work moves there at its first call (one quick visible action excepted); the person adds to or cancels a running job\'s plan through the main chat, and the Orchestrator sees what runs in the background.' },
      adaptiveLimits: { type: 'boolean', default: false, hint: 'Before a turn, a triage rates the request and sets its thinking effort and step budget (never under Max tool steps); a turn still advancing at its last step is extended up to limits.maxStepsCeiling.' },
      systemOne: { type: 'boolean', default: false, hint: 'A System 1 decision model (Laya, run on this hub, or TypeSafe Jev) answers bounded decisions — the triage\'s size, a call\'s answer-now-or-hand-on, a computer\'s next element (computer_next) — and today\'s way decides whenever it is unsure (systemOne.threshold).' } } };

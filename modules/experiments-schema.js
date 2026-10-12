'use strict';

/**
 * The declaration of prefs `experiments` (settings-schema.js reads it from here, beside experiments.js, which lists
 * them): one boolean per experiment, off by default, each written up in docs/experiments/<id>.md (hive.md §8). The
 * owner's switch alone — never proposable: an agent switching on its own experiments would be grading its own homework.
 */
module.exports = { is: 'travels', home: 'hive', note: 'experiments switched on (docs/experiments)',
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
      riskTiers: { type: 'boolean', default: false, hint: 'Each tool call is read, reversible or outward: reversible changes in a project run after a checkpoint, and outward ones (deleting outside a project, a force-push, mail, a request sending data out) are asked in every mode, Unattended included.' },
      adaptiveLimits: { type: 'boolean', default: false, hint: 'Before a turn, a triage rates the request and sets its thinking effort and step budget (never under Max tool steps); a turn still advancing at its last step is extended up to limits.maxStepsCeiling.' },
      systemOne: { type: 'boolean', default: false, hint: 'A System 1 decision model (Laya, run on this hub, or TypeSafe Jev) answers bounded decisions — the triage\'s size, a call\'s answer-now-or-hand-on, a computer\'s next element (computer_next) — and today\'s way decides whenever it is unsure (systemOne.threshold).' } } };

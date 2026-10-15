'use strict';

/**
 * The declaration of prefs `outsideAgents` (settings-schema.js reads it from here): other agents on this machine, step
 * by step, in the Workstream (outside-agents/). Reading other programs' records is the owner's decision, never an
 * agent's: nothing here is proposable, and it is off on a new install.
 */
const never = spec => ({ ...spec, propose: false });

module.exports = { is: 'local', home: 'device', on: 'host', note: 'other agents on this machine in the Workstream: whether their own session records are read and their OpenTelemetry received (outside-agents/) — the owner\'s, never proposable',
  keys: {
    enabled:  never({ type: 'boolean', default: false, hint: 'Show other agents\' steps in the Workstream — Claude Code, Codex, Gemini CLI running for this account: the commands they run and the files they edit, read from their own session records while the Workstream is open. Never their conversation, thinking or results.' }),
    otel:     never({ type: 'boolean', default: true, hint: 'Also receive what those agents export over OpenTelemetry, on a listener bound to 127.0.0.1 that runs only while one of them is running. They must be set to export there (Settings shows the lines).' }),
    otelPort: never({ type: 'integer', min: 1024, max: 65535, default: 4318, hint: 'The port of the OpenTelemetry receiver (OTLP/HTTP, JSON), on 127.0.0.1 only. 4318 is OpenTelemetry\'s own.' }),
  } };

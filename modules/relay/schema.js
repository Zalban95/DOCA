'use strict';

/**
 * The declaration of prefs `relay` (settings-schema.js reads it from here): the model relay (relay/index.js), through
 * which an agents' computer uses the hub's models without a provider key inside it. What it opens and to whom is the
 * owner's (approved 2026-10-14, CONSTITUTION S11): never proposable, and off on a new install.
 */
const never = (spec) => ({ ...spec, propose: false });

module.exports = { is: 'mixed', home: 'hive', note: 'the model relay (relay/): whether agents\' computers may use the hub\'s models through it, which models it offers, and where it listens on this machine — the owner\'s, never proposable',
  keys: {
    enabled:   never({ type: 'boolean', default: false, hint: 'Answer OpenAI-compatible requests (/v1/chat/completions, /v1/models) for the callers switched on below, sent on through this hub\'s own providers: the provider\'s key never leaves the hub.' }),
    computers: never({ type: 'boolean', default: true, hint: 'Agents\' computers whose own relay switch is on (Computers tab, or the computer tool) may use it, each with a token the hub made for it.' }),
    devices:   never({ type: 'boolean', default: false, hint: 'Paired devices may use it. Not available yet: it needs a device scope of its own, which waits for the owner\'s yes (CONSTITUTION S11).' }),
    models:    never({ type: 'array', default: [], hint: 'Which models it offers, each as provider/model. Empty: the harness\'s own model and its fallbacks.' }),
    port:      never({ type: 'integer', min: 1024, max: 65535, default: 4243, hint: 'The port of the relay\'s own small listener (plain HTTP, the Docker bridge only). Computers made before a change keep the old one in their environment; their relay file has the new one.' }),
    address:   never({ type: 'string', default: '', hint: 'The address that listener takes. Empty: the Docker bridge\'s gateway on Linux (what host.docker.internal is inside a computer), loopback elsewhere (Docker Desktop forwards to it). Never the tailnet or the LAN.' }),
  } };

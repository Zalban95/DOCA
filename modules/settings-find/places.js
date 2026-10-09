'use strict';

/**
 * Where the settings people ask for by name are, and what to click (deep test A, 2026-10-08: asked to "switch my theme
 * to light", "turn on manual approval" or "turn on developer mode", the agent searched settings_read and features until
 * it ran out of steps, and the header search found none of them). One row per thing a person calls a setting:
 *
 *   label    what it is, in their words
 *   paths    the prefs paths it is (settings-schema.js); `how` is worked out from them unless given
 *   page     a page id from nav.js, or settings/<section> (features/pages.js says it as the panel does)
 *   card     the title of the card it is in — the panel scrolls to it and marks it; field: a selector inside the page
 *   open     a panel action to run first (the ⚙ form is closed until opened)
 *   control  what to click, said to a person
 *   words    more words people use for it (index.js adds a few shared synonyms)
 *   host     a machine's setting: offered only to someone holding host
 */
module.exports = [
  { id: 'theme', label: 'Colour theme (dark, light…)', paths: ['theme'], page: 'settings/general', card: 'Appearance', field: '#theme-picker-grid',
    control: 'pick the colours under Appearance', words: 'theme colours colors dark light daylight night palette appearance',
    note: 'theme is "daylight" for light, "default" for dark; the others are named themes. Each screen keeps its own.' },
  { id: 'look', label: 'Look (Classic or Modern)', paths: ['skin'], page: 'settings/general', card: 'Appearance', field: '#theme-picker-grid',
    control: 'the two tiles at the top of Appearance', words: 'look skin style classic modern rounded font' },
  { id: 'text-size', label: 'Text size and spacing', paths: ['panel'], page: 'settings/general', card: 'Your panel', how: 'tool',
    tool: 'panel_layout {action: "change", steps: [{op: "style", fontScale: 1.2}]} (density: compact, normal or roomy)',
    control: 'Text size under Your panel', words: 'text size font bigger smaller larger zoom density spacing compact roomy' },
  { id: 'nav', label: 'Pages shown, their order and names', paths: ['panel', 'hiddenTabs'], page: 'settings/general', card: 'Your panel', how: 'tool',
    tool: 'panel_layout (show, then change: move, hide, show, rename)', control: 'Your panel, or Navigation Visibility',
    words: 'hide tab tabs page pages navigation menu order rename move group' },
  { id: 'sidebar', label: 'Sidebar and its stats', paths: ['sidebarStats', 'sidebarSections'], page: 'settings/general', card: 'Sidebar',
    control: 'tick what the sidebar shows', words: 'sidebar stats cpu gpu ram temperature' },
  { id: 'approval', label: 'Approval mode (Auto, Manual, Unattended)', paths: ['harness.approval.mode'], page: 'harness', field: '#hc-approval',
    control: 'the Auto / Manual switch above the conversation; "Approvals" beside it (also Settings → Harness → Approvals) lists what runs without asking',
    words: 'approval approvals approve manual auto automatic unattended ask asking before permission confirm allowlist always allow mode', host: true },
  { id: 'conv-approval', label: 'One conversation\'s own approval switch', paths: ['session.approval'], page: 'harness', how: 'password',
    control: 'the approval switch in that conversation\'s bar (here, or on its Projects chat tab)',
    words: 'approval manual auto conversation this chat only', host: true },
  { id: 'specialists', label: 'Specialists (sub-agents and missions)', paths: ['agents.enabled'], page: 'harness', field: '#hc-agents-on',
    control: 'the Specialists switch on Agents → Harness', words: 'specialists specialist sub-agents subagents missions dispatch experts tester researcher' },
  { id: 'developer', label: 'Developer mode', paths: ['developer.mode'], page: 'settings/experiments', card: 'Developer mode',
    control: 'the "Developer mode on this install" switch', words: 'developer dev mode experiments experimental testing', host: true },
  { id: 'experiments', label: 'Experiments (each one\'s switch)', paths: ['experiments'], page: 'settings/experiments',
    control: 'the "on" box beside each experiment — shown once developer mode is on', words: 'experiment experiments flag try', host: true },
  { id: 'network', label: 'Who can reach the hub (network)', paths: ['network.listen', 'network.lanAdmin', 'network.services'], page: 'settings/system', card: 'Network',
    control: 'the Network card', words: 'network listen lan wifi tailnet tailscale remote outside access reach', host: true },
  { id: 'log-keep', label: 'What is kept of logs and traces', paths: ['logs', 'tracing'], page: 'settings/system', card: 'Logs',
    control: 'the "What is kept" fold of the Logs card', words: 'logs log retention kept keep traces tracing history days', host: true },
  { id: 'sharing', label: 'Sharing what the agents learn with the project', paths: ['sharing.contribute'], page: 'settings/packs', card: 'Share with the project',
    control: 'the "Offer what my agents learn" box', words: 'share sharing contribute upstream project', host: true },
  { id: 'startup', label: 'Start at boot', paths: [], page: 'settings/general', card: 'Start at Boot', how: 'person',
    control: 'the Start at Boot card', words: 'boot startup autostart start login reboot systemd service', host: true },
  { id: 'updates', label: 'Updates and the version that runs', paths: ['updates.repo'], page: 'settings/general', card: 'Updates', how: 'password',
    control: 'Check, then Update (switching to another version asks for the password)', words: 'update upgrade version versions release', host: true },
  { id: 'agent-model', label: 'The agent\'s model, limits and timeouts', paths: ['harness.config.doca'], page: 'controls', open: 'harnessParams', field: '#harness-cfg-doca',
    control: 'DOCA\'s ⚙ on Controls (Settings → Harness → ⚙ Model & parameters opens it)',
    words: 'model provider temperature steps max tool steps maxsteps tokens reply length context window timeout first token fallback', host: true },
  { id: 'thinking', label: 'Thinking per kind of conversation', paths: ['thinking'], page: 'settings/harness', card: 'Thinking',
    control: 'the Thinking card', words: 'thinking think reasoning effort harder' },
  { id: 'web-search', label: 'Web search provider', paths: ['search.provider', 'search.url'], page: 'settings/harness', card: 'Web search',
    control: 'the Web search card', words: 'search web searxng brave tavily duckduckgo' },
  { id: 'missions-tidy', label: 'Finished missions put away', paths: ['missions'], page: 'settings/harness', card: 'Finished missions',
    control: 'the Finished missions card', words: 'archive tidy missions finished' },
  { id: 'paths', label: 'Folders DOCA uses (workspace, skills…)', paths: ['paths'], page: 'settings/system', card: 'Paths',
    control: 'the Paths card', words: 'paths folder folders directory workspace location', host: true },
  { id: 'voice', label: 'Voice: speech services and how a screen speaks', paths: ['voice', 'voiceServices'], page: 'settings/voice', card: 'Voice',
    control: 'the Voice card', words: 'voice voices speech speak speaking tts stt transcribe whisper kokoro speed' },
  { id: 'call', label: 'Calls: listening, the wake word, language', paths: ['call'], page: 'settings/voice', card: 'Calls',
    control: 'the Calls card', words: 'call calls microphone mic silence pause sensitivity wake word language listen' },
  { id: 'mic-keep', label: 'Microphone in the background', paths: ['call.micAlways'], page: null, how: 'person',
    control: 'the Mic switch beside the chats (the floating chat, Agents → Harness)', words: 'microphone mic background keep always open' },
  { id: 'assistant', label: 'Live call (the face): style, effort and model', paths: ['assistant'], page: 'settings/voice', card: 'Live call',
    control: 'the Live call card', words: 'assistant face live call quick style' },
  { id: 'face', label: 'The face\'s look', paths: ['face'], page: 'settings/voice', card: 'The face', control: 'the face card', words: 'face dots look avatar' },
  { id: 'ambient', label: 'The ambient screen', paths: ['ambient'], page: 'settings/ambient', control: 'where it is, what it shows and its margins', words: 'ambient screen saver clock weather place units margins' },
  { id: 'quiet-hours', label: 'A device\'s notifications and quiet hours', paths: [], page: 'apikeys', how: 'person',
    control: 'open the device\'s own page from its row, then its notifications (quiet hours, haptics, whether the agent may ask there)',
    words: 'quiet hours notifications notify haptics vibrate do not disturb phone watch device' },
  { id: 'spending', label: 'Budgets and spending permissions', paths: [], page: 'settings/spending', card: 'Budgets', how: 'password',
    control: 'the Budgets card', words: 'budget budgets money cost spend spending limit tokens per day month' },
  { id: 'users', label: 'People, levels and grants', paths: [], page: 'settings/users', how: 'password',
    control: 'Settings → Users', words: 'users people accounts account level levels member admin grant grants invite password', host: true },
  { id: 'computers', label: 'Agents\' computers: how many, when they stop', paths: ['computers'], page: 'computers', field: '[data-leaf="computers.maxRunning"]',
    control: 'the Advanced fold on Computers', words: 'computers computer container desktop idle stop remove', host: true },
  { id: 'mcp-timeouts', label: 'MCP timeouts', paths: ['mcpSettings'], page: 'mcp', field: '[data-leaf="mcpSettings.callTimeoutMs"]',
    control: 'the Advanced fold on MCP', words: 'mcp timeout tool server wait', host: true },
];

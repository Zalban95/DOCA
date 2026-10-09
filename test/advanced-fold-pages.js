'use strict';

/**
 * The pages that fold their fields most people never touch (AGENTS.md, "Organized: the common few, the rest under
 * Advanced"), as test/advanced-fold.test.js opens them: how to open each in the panel, what to wait for, every field it
 * must still draw (selectors), which of them sit under Advanced and which of the common few must not.
 */
const fs = require('node:fs');
const path = require('node:path');

// The harness ⚙ parameters, from the table the form is drawn from: `common: true` shown, the rest folded.
const table = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'harness', 'param-table.js'), 'utf8');
const params = [...table.matchAll(/\{ key: '(\w+)',( common: true,)?/g)].map(m => ({ key: m[1], common: !!m[2] }));
const hcfg = k => `#hcfg-${k}-doca`;
// Until the page's own data is in (a fixed wait was too short on a slow Windows runner), at most 15 s.
const loaded = expr => `for (let t = 0; t < 15000 && !(${expr}); t += 100) await new Promise(r => setTimeout(r, 100));`;
const sub = id => `nav('settings'); settingsSubNav(${JSON.stringify(id)});`;

module.exports = [
  { name: 'Controls → DOCA ⚙ parameters', go: 'await settingsOpenHarnessParams();', ready: hcfg('memoryLimit'), scope: '#harness-cfg-doca',
    fields: [...params.map(p => hcfg(p.key)), hcfg('provider'), hcfg('model'), hcfg('systemPrompt'), '#hcfg-fallbacks-doca', '#hcfg-escalate-doca'],
    folded: [...params.filter(p => !p.common).map(p => hcfg(p.key)), '#hcfg-fallbacks-doca', '#hcfg-escalate-doca'],
    shown: [...params.filter(p => p.common).map(p => hcfg(p.key)), hcfg('provider'), hcfg('model'), hcfg('systemPrompt')] },
  { name: 'Settings → Users, the level editor', go: `${sub('users')} ${loaded('_usersData.rights.length')} usersLevelEdit();`, ready: '#lvl-delegates', scope: '#users-level-modal',
    fields: ['#lvl-name', '[data-right="host"]', '#lvl-settings', '#lvl-allow', '#lvl-deny', '#lvl-approval', '#lvl-reach', '[data-resource="model"]', '[data-resource="home"]', '#lvl-delegates'],
    folded: ['#lvl-settings', '#lvl-allow', '#lvl-deny', '[data-resource="model"]', '[data-resource="home"]', '#lvl-delegates'],
    shown: ['#lvl-name', '[data-right="host"]', '#lvl-approval', '#lvl-reach'],
    after: "document.getElementById('users-level-overlay').style.display = 'none';" },
  { name: 'Field → MCP, adding a server', go: "nav('mcp'); mcpShowForm(true);", ready: '#mcp-form', scope: '#mcp-form',
    fields: ['#mcp-name', '#mcp-transport', '#mcp-command', '#mcp-args', '#mcp-env', '#mcp-cwd', '#mcp-url', '#mcp-origin-kind', '#mcp-origin-device', '#mcp-headers', '#mcp-autostart'],
    folded: ['#mcp-env', '#mcp-cwd', '#mcp-headers'], shown: ['#mcp-name', '#mcp-transport', '#mcp-command', '#mcp-args', '#mcp-url', '#mcp-autostart'],
    after: 'mcpShowForm(false);' },
  { name: 'Settings → System: paths, network, logs', go: sub('system'), ready: '#log-keep-card [data-log-keep]', scope: '#sp-system',
    fields: ['#path-in-WORKSPACE_DIR', '#path-in-ATTACHMENTS_DIR', '#path-in-COMPOSE_DIR', '#path-in-SNAPSHOT_SCRIPT', 'input[name="net-listen"]', '#net-lanadmin', '#net-services', '[data-log-keep]'],
    folded: ['#path-in-COMPOSE_DIR', '#path-in-SNAPSHOT_SCRIPT', '#net-lanadmin', '#net-services', '[data-log-keep]'],
    shown: ['#path-in-WORKSPACE_DIR', '#path-in-ATTACHMENTS_DIR', 'input[name="net-listen"]'] },
  { name: 'Settings → General: pages and stats', go: sub('general'), ready: '#stat-toggle-cpu', scope: '#sp-general',
    fields: ['#settings-show-mcp', '#stat-toggle-cpu', '#startup-toggle'], folded: ['#settings-show-mcp', '#stat-toggle-cpu'], shown: ['#startup-toggle'] },
  { name: 'Settings → Spending: budgets', go: sub('spending'), ready: '#sp-pp-tokensPerDay', scope: '#sp-spending',
    fields: ['#sp-own-tokensPerDay', '#sp-own-moneyPerMonth', '#sp-person', '#sp-pp-tokensPerDay', '#sp-lv-member-allow'],
    folded: ['#sp-person', '#sp-pp-tokensPerDay', '#sp-lv-member-allow'], shown: ['#sp-own-tokensPerDay', '#sp-own-moneyPerMonth'] },
  { name: 'Settings → Voice: the Voice card', go: sub('voice'), ready: '#vc-quick-speed', scope: '#voice-card',
    fields: ['#vc-engine', '#vc-voice', '#vc-speed', '#vc-split', '#vc-quick-service', '#vc-quick-voice', '#vc-quick-speed', '#vc-deep-speed', '#vc-ambient-speed'],
    folded: ['#vc-speed', '#vc-quick-speed', '#vc-deep-speed', '#vc-ambient-speed'], shown: ['#vc-engine', '#vc-voice', '#vc-split', '#vc-quick-service', '#vc-quick-voice'] },
  { name: 'Settings → Voice: assistant mode, the face', go: sub('voice'), ready: '[data-face="dots"]', scope: '#sp-voice',
    fields: ['#as-effort', '#as-reply', '#as-provider', '#as-model', '#as-calls', '#as-front', '#as-style', '[data-face="form"]', '[data-face="accent"]', '[data-face="dots"]', '[data-face="glow"]', '[data-face="ask"]'],
    folded: ['#as-provider', '#as-model', '#as-calls', '#as-front', '#as-style', '[data-face="dots"]', '[data-face="glow"]', '[data-face="ask"]'],
    shown: ['#as-effort', '#as-reply', '#lc-silence', '[data-face="form"]', '[data-face="accent"]'] },
  { name: 'Settings → Ambient', go: sub('ambient'), ready: '#amb-f-24', scope: '#sp-ambient',
    fields: ['#amb-f-place', '[data-show="weather"]', '#amb-f-buttons', '#amb-f-auto', '#amb-f-units', '#amb-f-mx', '#amb-f-my', '#amb-f-listen', '#amb-f-24'],
    folded: ['#amb-f-auto', '#amb-f-units', '#amb-f-mx', '#amb-f-my', '#amb-f-listen', '#amb-f-24'], shown: ['#amb-f-place', '[data-show="weather"]', '#amb-f-buttons'] },
  { name: 'Field → Connectors', go: "nav('connectors');", ready: '#sk-who', scope: '#sp-connectors',
    fields: ['[data-f="clientId"]', '[data-f="clientSecret"]', '[data-f="scopes"]', '[data-f="who"]', '#sk-name', '#sk-origin', '#sk-key', '#sk-note', '#sk-place', '#sk-field', '#sk-who'],
    folded: ['[data-f="scopes"]', '[data-f="who"]', '#sk-place', '#sk-field', '#sk-who'], shown: ['[data-f="clientId"]', '[data-f="clientSecret"]', '#sk-name', '#sk-origin', '#sk-key'] },
  { name: 'Settings → Packs', go: sub('packs'), ready: '#pack-ed-level', scope: '#sp-packs',
    fields: ['#pack-name', '#pack-memory', '#pack-ed-branding', '#pack-ed-look', '#pack-ed-face', '#pack-ed-level'],
    folded: ['#pack-ed-branding', '#pack-ed-look', '#pack-ed-face', '#pack-ed-level'], shown: ['#pack-name', '#pack-memory'] },
  { name: 'Settings → Backups, the off-site copy', go: sub('backups'), ready: '#bremote-region', scope: '#sp-backups',
    fields: ['#bremote-endpoint', '#bremote-bucket', '#bremote-region', '#bremote-prefix', '#bremote-keep', '#bremote-enc', '#bremote-akid', '#bremote-on'],
    folded: ['#bremote-region', '#bremote-prefix', '#bremote-keep', '#bremote-enc'], shown: ['#bremote-endpoint', '#bremote-bucket', '#bremote-akid', '#bremote-on'] },
  { name: 'Settings → Channels, mail', go: sub('channels'), ready: '#ml-auth', scope: '#sp-channels',
    fields: ['#ml-imap', '#ml-smtp', '#ml-auth', '#ml-user', '#ml-pass'], folded: ['#ml-auth'], shown: ['#ml-imap', '#ml-smtp', '#ml-user'] },
];

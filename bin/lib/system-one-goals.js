'use strict';

/**
 * The pages and goals the System 1 browser cases are captured from (system-one-capture.js): a page of a throwaway
 * panel, and for each goal the snapshot line(s) of the element that is the right next step — a pattern, so the case
 * survives the numbers changing — and how it is used. Labelled by hand from `--capture --show`.
 */
const g = (goal, match, how = 'click') => ({ goal, match, how });

module.exports = [
  { name: 'controls', go: "nav('controls')", goals: [
    g('open Settings', '\\] button:submit "SETTINGS"$'),
    g('add another agent harness', 'ADD ANOTHER AGENT'),
    g('search the panel for the backup settings', 'input:text "Search pages', 'type'),
    g('go to the ambient screen', '\\] button:submit "AMBIENT"$'),
    g('add my own agent called Jarvis', 'Add your own agent — name', 'type'),
  ] },
  { name: 'settings', go: "nav('settings'); settingsSubNav('general')", goals: [
    g('change my password', 'CHANGE PASSWORD'),
    g('sign out of the panel', '\\] button:submit "SIGN OUT"$'),
    g('open the voice settings', '\\] button:submit "Voice"$'),
    g('manage the people who can use this hub', '\\] button:submit "Users"$'),
    g('switch to the Nord theme', '\\] div "Nord"$'),
    g('make the text bigger', 'select:select-one "90% 100%', 'type'),
  ] },
  { name: 'apikeys', go: "nav('apikeys')", goals: [
    g('pair a device', 'PAIR A DEVICE'),
    g('add a provider', '\\+ ADD PROVIDER'),
    g('set up DeepSeek as a provider', '"DEEPSEEK"$'),
    g('issue a token for a script', 'ISSUE TOKEN'),
  ] },
  { name: 'mcp', go: "nav('mcp')", goals: [
    g('add an MCP server', '\\+ ADD SERVER'),
    g('refresh the list of servers', 'REFRESH'),
  ] },
  { name: 'connectors', go: "nav('connectors')", goals: [
    g('add a key for a service called hyper3d', 'name \\(hyper3d\\)', 'type'),
    g('save a login for a website', 'site \\(https://github.com\\)', 'type'),
    g('keep a secret for my devices', 'name \\(bank-pin\\)', 'type'),
    g('add another OAuth service', 'ANOTHER OAUTH'),
  ] },
  { name: 'models', go: "nav('models')", goals: [
    g('download the Ollama model qwen2.5:7b', 'model name \\(e.g. llama3.2', 'type'),
    g('search Hugging Face for whisper models', 'Search HuggingFace Hub', 'type'),
    g('train the wake word', 'TRAIN “DOCA”'),
    g('add a llama.cpp instance', '\\+ ADD INSTANCE'),
  ] },
  { name: 'harness', go: "nav('harness')", goals: [
    g('send a message to the orchestrator', 'Message your Orchestrator', 'type'),
    g('start a new work chat', '\\] button:submit "\\+ WORK"$'),
    g('edit the memory rules', '\\] button:submit "RULES"$'),
    g('see what is waiting for approval', '\\] button:submit "APPROVALS"$'),
  ] },
  { name: 'users', go: "nav('settings'); settingsSubNav('users')", goals: [
    g('add a person to this hub', 'ADD PERSON|input:text "email"$'),
    g('make a new permission level', 'NEW LEVEL'),
    g('reset someone\'s password', 'RESET PASSWORD'),
    g('go to the Developer settings', '\\] button:submit "Developer"$'),
  ] },
];

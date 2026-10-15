'use strict';

/**
 * What a person sets so an agent exports to the hub's OpenTelemetry receiver (Settings shows it, with a copy button).
 * The hub never writes another program's configuration: these are the lines, and where they go. Each agent's own
 * documentation names them; tool details are asked for so a step names its command, prompts are left out.
 */
const os = require('os');
const path = require('path');

function lines(port = 4318) {
  const url = `http://127.0.0.1:${port}`;
  return [
    { agent: 'claude', label: 'Claude Code', where: 'the environment Claude Code starts in (a shell profile, or "env" in ~/.claude/settings.json)', kind: 'env',
      text: ['CLAUDE_CODE_ENABLE_TELEMETRY=1', 'OTEL_LOGS_EXPORTER=otlp', 'OTEL_METRICS_EXPORTER=otlp', 'OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        `OTEL_EXPORTER_OTLP_ENDPOINT=${url}`, 'OTEL_LOG_TOOL_DETAILS=1'].map(l => `export ${l}`).join('\n') },
    { agent: 'codex', label: 'Codex', where: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), kind: 'toml',
      text: ['[otel]', 'log_user_prompt = false', `exporter = { otlp-http = { endpoint = "${url}/v1/logs", protocol = "json" } }`].join('\n') },
    { agent: 'gemini', label: 'Gemini CLI', where: path.join(os.homedir(), '.gemini', 'settings.json'), kind: 'json',
      text: JSON.stringify({ telemetry: { enabled: true, target: 'local', otlpEndpoint: url, otlpProtocol: 'http', logPrompts: false } }, null, 2) },
  ];
}

module.exports = { lines };

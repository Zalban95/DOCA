'use strict';

/**
 * What another agent exports over OpenTelemetry (OTLP/HTTP JSON), as steps (../index.js). Pure: a request body in,
 * steps out. Logs carry the agents' events — Claude Code's `claude_code.tool_result` and `claude_code.api_request`,
 * Codex's `codex.tool_result` and its `response.completed` stream event, Gemini CLI's `gemini_cli.tool_call` and
 * `gemini_cli.api_response`; traces carry `gen_ai.*` spans (an `execute_tool` span is a step, a model span a request).
 * Read: the tool, the command or file its parameters name, success, time, the model and its tokens and cost. Never read:
 * a prompt, a tool's output, a response's text — events of those kinds (user_prompt, a span's messages) are dropped.
 * Metrics are counted and say nothing (a running total is not a step).
 */
const AGENT = [
  { id: 'claude', label: 'Claude Code', match: /^claude[_-]code/ },
  { id: 'codex', label: 'Codex', match: /^codex/ },
  { id: 'gemini', label: 'Gemini CLI', match: /^gemini/ },
];

/** An OTLP AnyValue as a plain value. */
function val(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('boolValue' in v) return !!v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(val);
  if (v.kvlistValue) return attrs(v.kvlistValue.values);
  return null;
}
function attrs(list) {
  const o = {};
  for (const kv of Array.isArray(list) ? list : []) if (kv && typeof kv.key === 'string') o[kv.key] = val(kv.value);
  return o;
}
const json = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(String(s)); } catch { return {}; } };
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const ms = nano => (nano ? Math.round(Number(nano) / 1e6) : Date.now());
const truthy = v => v === true || v === 'true' || v === 1;

function agentOf(name, service) {
  return AGENT.find(a => a.match.test(String(name || ''))) || AGENT.find(a => a.match.test(String(service || '').replace(/_/g, '-'))) || null;
}

/** A tool's parameters, as the step names them: a command or a file. */
function params(tool, p) {
  const command = p.bash_command || p.full_command || p.command || p.cmd;
  const line = Array.isArray(command) ? require('../codex').lineOf(command) : command;
  if (typeof line === 'string' && line) return { kind: 'command', command: line };
  const file = p.file_path || p.notebook_path || p.absolute_path || p.path;
  if (typeof file === 'string' && file) return { kind: /^(Read|read_file)$/.test(tool) ? 'read' : /edit|write|replace|patch/i.test(tool) ? 'edit' : 'tool', files: [file] };
  return { kind: 'tool' };
}

/** One log record (an event) as a step, or null. */
function event(rec, resource) {
  const a = attrs(rec.attributes);
  const name = a['event.name'] || val(rec.body) || '';
  const ag = agentOf(name, resource['service.name']);
  if (!ag) return null;
  const event = String(name).replace(/^[a-z_-]+\./, '');
  const base = { agent: ag.id, label: ag.label, session: String(a['session.id'] || a['conversation.id'] || resource['session.id'] || ''),
    at: ms(rec.timeUnixNano || rec.observedTimeUnixNano) };
  if (event === 'tool_result' || event === 'tool_call') {
    const tool = String(a.tool_name || a.function_name || 'a tool').slice(0, 80);
    const p = json(a.tool_parameters || a.arguments || a.function_args);
    return { ...base, tool, ...params(tool, p), failed: a.success != null && !truthy(a.success), ms: num(a.duration_ms) };
  }
  if (event === 'api_request' || event === 'api_response' || (event === 'sse_event' && a['event.kind'] === 'response.completed')) {
    if (event === 'api_request' && ag.id === 'codex') return null;   // Codex's request event carries no tokens: its completion does
    return { ...base, kind: 'model', tool: 'model', model: a.model || a['gen_ai.request.model'] || null,
      input: num(a.input_tokens ?? a.input_token_count), output: num(a.output_tokens ?? a.output_token_count),
      cached: num(a.cache_read_tokens ?? a.cached_token_count ?? a.cached_content_token_count), cost: num(a.cost_usd), ms: num(a.duration_ms),
      failed: a.status_code != null && Number(a.status_code) >= 400 };
  }
  if (event === 'api_error') return { ...base, kind: 'model', tool: 'model', model: a.model || null, failed: true, ms: num(a.duration_ms) };
  return null;   // prompts, decisions, configuration: not steps
}

/** One span as a step, or null: a tool's execution, or a model request. */
function span(sp, resource) {
  const a = attrs(sp.attributes);
  const ag = agentOf(sp.name, resource['service.name']);
  if (!ag) return null;
  const at = ms(sp.startTimeUnixNano), dur = sp.endTimeUnixNano && sp.startTimeUnixNano ? Math.round((Number(sp.endTimeUnixNano) - Number(sp.startTimeUnixNano)) / 1e6) : null;
  const base = { agent: ag.id, label: ag.label, session: String(a['session.id'] || a['gen_ai.conversation.id'] || a['conversation.id'] || ''), at, ms: dur,
    failed: sp.status?.code === 2 || sp.status?.code === 'STATUS_CODE_ERROR' };
  const tool = a['gen_ai.tool.name'] || a.tool_name;
  if (a['gen_ai.operation.name'] === 'execute_tool' || tool) {
    const t = String(tool || 'a tool').slice(0, 80);
    return { ...base, tool: t, ...params(t, json(a['gen_ai.tool.call.arguments'] || a.tool_parameters)) };
  }
  if (a['gen_ai.request.model'] || a['gen_ai.response.model']) {
    return { ...base, kind: 'model', tool: 'model', model: a['gen_ai.response.model'] || a['gen_ai.request.model'],
      input: num(a['gen_ai.usage.input_tokens']), output: num(a['gen_ai.usage.output_tokens']), cached: num(a['gen_ai.usage.cache_read_input_tokens']), cost: null };
  }
  return null;
}

/** A body sent to /v1/logs, /v1/traces or /v1/metrics: its steps, and how many records it held. */
function steps(kind, body) {
  const out = [];
  let records = 0;
  if (kind === 'logs') for (const rl of body?.resourceLogs || []) {
    const res = attrs(rl.resource?.attributes);
    for (const sl of rl.scopeLogs || []) for (const r of sl.logRecords || []) { records++; const s = event(r, res); if (s) out.push(s); }
  }
  if (kind === 'traces') for (const rs of body?.resourceSpans || []) {
    const res = attrs(rs.resource?.attributes);
    for (const ss of rs.scopeSpans || []) for (const sp of ss.spans || []) { records++; const s = span(sp, res); if (s) out.push(s); }
  }
  if (kind === 'metrics') for (const rm of body?.resourceMetrics || []) for (const sm of rm.scopeMetrics || []) records += (sm.metrics || []).length;
  return { steps: out.sort((x, y) => x.at - y.at), records };
}

module.exports = { steps, event, span, attrs, val, agentOf, AGENT };

'use strict';

/**
 * A turn's trace as OTLP/JSON (OpenTelemetry's own interchange format, `resourceSpans`), so it opens in Jaeger,
 * Grafana Tempo, Langfuse or anything behind an OpenTelemetry collector — [IO]: exported in the format other tools
 * read natively. The run is the root span; each model request and tool call a child, named and attributed in the
 * GenAI semantic conventions (`gen_ai.*`) where one exists. Spans without a duration (an approval, a warning) are
 * events on the root span. Times are nanoseconds since the epoch, as strings.
 */
const crypto = require('crypto');

const ns = iso => `${BigInt(new Date(iso).getTime()) * 1000000n}`;
const hex = (seed, bytes) => crypto.createHash('sha256').update(seed).digest('hex').slice(0, bytes * 2);
const attr = (key, v) => (v === null || v === undefined ? null
  : { key, value: typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } });
const attrs = o => Object.entries(o).map(([k, v]) => attr(k, v)).filter(Boolean);

function otlp(run, spans, { service = 'doca' } = {}) {
  const traceId = hex(run.id, 16), rootId = hex(`${run.id}/root`, 8);
  const end = run.endedAt || spans.at(-1)?.at || run.startedAt;
  const children = spans.filter(s => s.kind === 'model' || s.kind === 'tool').map(s => {
    const endNs = BigInt(ns(s.at)), startNs = endNs - BigInt(Math.max(0, s.ms || 0)) * 1000000n;
    const d = s.data || {};
    const a = s.kind === 'model'
      ? attrs({ 'gen_ai.operation.name': 'chat', 'gen_ai.system': d.provider, 'gen_ai.request.model': d.model, 'gen_ai.usage.input_tokens': d.prompt,
        'gen_ai.usage.output_tokens': d.completion, 'gen_ai.response.finish_reasons': d.finish, 'doca.step': s.step, 'doca.messages': d.messages,
        'doca.tools': d.tools, 'doca.system_prompt_sha256': d.system, 'doca.cached_tokens': d.cached, 'doca.tool_calls': (d.calls || []).join(',') || null })
      : attrs({ 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': s.name, 'doca.step': s.step, 'doca.args': (d.args || []).join(',') || null,
        'doca.result_chars': d.chars, 'doca.failure': d.failure, 'doca.risk.tier': d.tier, 'doca.risk.way': d.way });
    return { traceId, spanId: hex(`${run.id}/${s.seq}`, 8), parentSpanId: rootId, name: s.kind === 'model' ? `chat ${d.model || ''}`.trim() : `execute_tool ${s.name}`,
      kind: s.kind === 'model' ? 3 : 1, startTimeUnixNano: `${startNs}`, endTimeUnixNano: `${endNs}`, attributes: a,
      status: s.kind === 'tool' && d.failure ? { code: 2, message: d.failure } : { code: 0 } };
  });
  const events = spans.filter(s => s.kind !== 'model' && s.kind !== 'tool')
    .map(s => ({ timeUnixNano: ns(s.at), name: s.kind, attributes: attrs({ 'doca.name': s.name, 'doca.step': s.step, ...Object.fromEntries(Object.entries(s.data || {}).map(([k, v]) => [`doca.${k}`, v])) }) }));
  const root = { traceId, spanId: rootId, name: `turn ${run.kind || 'turn'}`, kind: 1, startTimeUnixNano: ns(run.startedAt), endTimeUnixNano: ns(end),
    attributes: attrs({ 'doca.run': run.id, 'doca.session': run.sessionId, 'doca.mission': run.missionId, 'doca.state': run.state, 'doca.steps': run.steps, 'doca.tokens': run.tokens }),
    events, status: run.state === 'failed' ? { code: 2, message: String(run.outcome || '').slice(0, 200) } : { code: 0 } };
  return { resourceSpans: [{ resource: { attributes: attrs({ 'service.name': service, 'service.version': require('../../package.json').version }) },
    scopeSpans: [{ scope: { name: 'doca.harness' }, spans: [root, ...children] }] }] };
}

module.exports = { otlp };

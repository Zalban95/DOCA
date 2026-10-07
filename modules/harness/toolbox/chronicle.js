'use strict';

/**
 * What happened, for the agent (TODO B6b; audit 2026-10-06 aw 10): Chronicle's rows and stories (modules/chronicle)
 * — runs, missions, device jobs, what the hub did on its own, the harness log and each turn's trace — read through the
 * same functions as Agents → Chronicle, so the agent answers "what happened overnight", "why did that mission fail",
 * "what did that cost" from the record instead of guessing. It only reads: every row is scoped to the person the turn
 * acts for by the transcript's own rule (a host sees everything, anyone else their own conversations and devices; the
 * harness log is a host's), and nothing in it carries a conversation's words beyond each run's first line of outcome.
 * The logs and traces stay where they are; this is their reader.
 */
const AGO = { m: 60e3, h: 3600e3, d: 86400e3 };

/** "24h", "7d", "30m" or an ISO time → an ISO time; nothing → nothing. */
function since(v) {
  if (!v) return null;
  const m = /^(\d+)\s*([mhd])$/.exec(String(v).trim());
  if (m) return new Date(Date.now() - Number(m[1]) * AGO[m[2]]).toISOString();
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const when = iso => String(iso || '').replace('T', ' ').slice(0, 16);
const toks = n => (n ? ` · ${n.toLocaleString('en')} tokens` : '');

function row(r) {
  if (r.source === 'log' || r.source === 'hub') return `${when(r.at)} [${r.source}${r.level && r.level !== 'info' ? ` ${r.level}` : ''}] ${String(r.text).slice(0, 240)}`;
  return `${when(r.at)} ${r.state} — ${r.agent.label}: ${r.title || '(untitled)'}${r.device ? ` · from ${r.device.name}` : ''}${r.person ? ` · ${r.person.name}` : ''}`
    + `${toks(r.tokens)}${r.steps ? ` · ${r.steps} steps` : ''} (run ${r.id}${r.sessionId ? `, conversation ${r.sessionId}` : ''})${r.outcome ? `\n    ${r.outcome.slice(0, 200)}` : ''}`;
}

function story(s) {
  const t = s.totals, out = [`${s.title} (${s.kind}${s.sessionId ? `, conversation ${s.sessionId}` : ''})`,
    `${t.runs} run${t.runs === 1 ? '' : 's'} · ${t.steps} steps · ${t.toolCalls} tool calls (${t.failedTools} failed) · ${t.tokens.toLocaleString('en')} tokens`
      + ` (${t.cached.toLocaleString('en')} cached)${t.cost != null ? ` · cost ${t.cost.toFixed(4)} ${t.currency || ''}` : ''}${t.failedRuns ? ` · ${t.failedRuns} failed` : ''}`];
  if (s.mission) out.push(`Mission for ${s.mission.agent}: ${s.mission.state}${s.mission.error ? ` — ${s.mission.error}` : ''}`);
  for (const r of s.runs.slice(-12)) {
    const m = r.summary, tools = Object.entries(m.tools).map(([n, c]) => `${n}×${c}`).join(', ');
    out.push(`- ${when(r.at)} ${r.state}: ${r.why}`,
      `    models ${Object.keys(m.models).join(', ') || 'none'}${tools ? `; tools ${tools}` : ''}${m.refused ? `; ${m.refused} refused` : ''}${m.failovers ? `; ${m.failovers} failovers` : ''}`
      + `${m.failed.length ? `; failed: ${m.failed.map(f => `${f.name} (${String(f.why).slice(0, 80)})`).join(', ')}` : ''}${m.errors.length ? `; errors: ${m.errors.join('; ').slice(0, 200)}` : ''}`,
      ...(r.outcome ? [`    ${r.outcome.slice(0, 200)}`] : []));
  }
  if (s.runs.length > 12) out.splice(3, 0, `(the last 12 of ${s.runs.length} runs)`);
  if (s.children.length) out.push('Started from it:', ...s.children.map(c => `- ${c.agent}: ${c.title || c.sessionId} (${c.state || '?'}, conversation ${c.sessionId})`));
  const errs = (s.log || []).filter(l => l.level !== 'info').slice(-5);
  if (errs.length) out.push('Log lines (warnings and errors):', ...errs.map(l => `- ${when(l.ts)} ${String(l.text).slice(0, 200)}`));
  return out.join('\n');
}

module.exports = [
  {
    name: 'chronicle',
    description: 'Read what happened: past turns, missions, device jobs, what the hub did on its own, the harness log, and the story of one piece '
      + 'of work with its models, tools, failures and cost — use it when the person asks what happened, why something failed or what it cost. '
      + 'find lists runs (newest first) by words, source, state and time; story tells one run, conversation or mission from its traces. '
      + 'Only what the person this turn acts for may see.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['find', 'story'] },
        q: { type: 'string', description: 'find: words in a title, outcome, agent, device or person.' },
        source: { type: 'string', enum: ['turn', 'mission', 'job', 'hub', 'log'], description: 'find: turns, missions, device jobs, what the hub did on its own, or the harness log (an admin\'s).' },
        state: { type: 'string', description: 'find: done, failed, cancelled or running (for hub and log: info, warn or error).' },
        since: { type: 'string', description: 'find: from when — "24h", "7d", "30m" or an ISO time.' },
        limit: { type: 'integer', description: 'find: how many (default 20, at most 100).' },
        run: { type: 'string', description: 'story: a run id from find.' },
        conversation: { type: 'string', description: 'story: a conversation id.' },
        mission: { type: 'string', description: 'story: a mission id.' },
      },
      required: ['action'],
    },
    run: ({ action, q, source, state, since: from, limit, run, conversation, mission }, ctx = {}) => {
      const person = ctx.user || null;
      try {
        if (action === 'find') {
          const n = Math.min(100, Math.max(1, Number(limit) || 20));
          const r = require('../../chronicle').query(person, { q, source, state, from: since(from), limit: n });
          if (r.note) return r.note;
          if (!r.rows.length) return `Nothing in the chronicle${q ? ` for "${q}"` : ''}${from ? ` since ${from}` : ''}.`;
          const t = r.totals || {};
          return [`${r.total} found${r.total > r.rows.length ? `, the newest ${r.rows.length}` : ''}${t.failed ? ` · ${t.failed} failed` : ''}${t.tokens ? toks(t.tokens) : ''}:`,
            ...r.rows.map(row)].join('\n');
        }
        if (action !== 'story') return 'Error: action is find or story.';
        if (!run && !conversation && !mission) return 'Error: story needs run, conversation or mission (find gives their ids).';
        return story(require('../../chronicle/story').story(person, { run, session: conversation, mission }));
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];

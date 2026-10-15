'use strict';

/**
 * One step, said once (index.js): the same tool call can arrive by both routes — the agent's own record (`record`) and
 * its OpenTelemetry export (`otel`). A step is known by its agent, session, tool and what it named (the command or the
 * files); one arriving by the other route within WINDOW_MS takes the place of the first unmatched one and is not said
 * again — a command run twice by the same route is said twice. OpenTelemetry without tool details names only the
 * tool: it then matches the oldest unmatched record step of that tool in that session, and is said only when none waits.
 */
const WINDOW_MS = 10 * 60e3;
const _seen = [];   // { key, tool, via, at, matched }, oldest first

const detail = s => (s.command ? String(s.command).replace(/\s+/g, ' ').trim() : (s.files || []).join('|'));
const toolKey = s => `${s.agent}|${s.session || ''}|${s.tool || ''}`;

/** True when this step was already said by the other route (it is then matched); else it is recorded and false. */
function again(step, via, now = Date.now()) {
  if (step.kind === 'model') return false;
  while (_seen.length && (now - _seen[0].at > WINDOW_MS || _seen.length > 2000)) _seen.shift();
  const tool = toolKey(step), d = detail(step), key = d ? `${tool}|${d}` : null;
  const twin = _seen.find(e => !e.matched && e.via !== via && e.tool === tool && (!key || !e.key || e.key === key));
  if (twin) { twin.matched = true; return true; }
  _seen.push({ key, tool, via, at: now, matched: false });
  return false;
}

module.exports = { again, WINDOW_MS, _reset: () => { _seen.length = 0; } };

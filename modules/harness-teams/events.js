'use strict';

/**
 * An outside harness's own event stream, one JSON line at a time, read into a few plain kinds the hub shows
 * mechanically (harness-teams/): never summarised by a model, never reworded — a command as the CLI ran it, a file as
 * the CLI named it, its own final words as it wrote them.
 *
 *   {type: 'command', text}            a shell command it ran
 *   {type: 'tool', tool, path?, args}  any other tool it called (argument names only, plus a path when it names one)
 *   {type: 'result', ok, text}         the first line of what a tool gave back
 *   {type: 'text', text}               what it said along the way
 *   {type: 'final', ok, text, cost?}   its last words, and whether it says it finished
 *   {type: 'error', text}
 *
 * Each reader follows that tool's documentation (the links are on its catalog row, harness/catalog.js).
 */
const first = s => String(s ?? '').split('\n').find(l => l.trim()) || '';
const SHELL = /^(bash|shell|run_shell_command|exec_command|terminal|run_terminal_cmd|local_shell)$/i;

function toolEvent(name, input) {
  const args = input && typeof input === 'object' ? input : {};
  if (SHELL.test(String(name)) && (args.command || args.cmd)) return { type: 'command', text: String(Array.isArray(args.command) ? args.command.join(' ') : (args.command || args.cmd)) };
  const path = args.file_path || args.path || args.absolute_path || args.filePath || null;
  return { type: 'tool', tool: String(name || 'tool'), ...(path ? { path: String(path) } : {}), args: Object.keys(args).filter(k => !/pass|token|secret|key|content|body/i.test(k)) };
}

/** Claude Code's stream-json: assistant messages with tool_use and text blocks, user tool_result blocks, then result. */
function claude(e) {
  const out = [];
  const blocks = Array.isArray(e?.message?.content) ? e.message.content : [];
  if (e.type === 'assistant') for (const b of blocks) {
    if (b.type === 'tool_use') out.push(toolEvent(b.name, b.input));
    else if (b.type === 'text' && b.text?.trim()) out.push({ type: 'text', text: b.text });
  } else if (e.type === 'user') for (const b of blocks) {
    if (b.type !== 'tool_result') continue;
    const text = Array.isArray(b.content) ? b.content.map(c => c.text || '').join('\n') : b.content;
    out.push({ type: 'result', ok: !b.is_error, text: first(text).slice(0, 200) });
  } else if (e.type === 'result') out.push({ type: 'final', ok: e.subtype === 'success' && !e.is_error, text: String(e.result ?? ''), ...(typeof e.total_cost_usd === 'number' ? { cost: e.total_cost_usd } : {}) });
  return out;
}

/** Codex's `exec --json`: item.started / item.completed (command_execution, file_change, agent_message), turn.failed. */
function codex(e) {
  const it = e.item || {};
  if (e.type === 'item.started' && it.type === 'command_execution') return [{ type: 'command', text: String(it.command || '') }];
  if (e.type === 'item.completed') {
    if (it.type === 'command_execution') return [{ type: 'result', ok: it.exit_code === 0, text: first(it.aggregated_output).slice(0, 200) || `exit ${it.exit_code}` }];
    if (it.type === 'file_change') return (it.changes || []).map(c => ({ type: 'tool', tool: `file ${c.kind || 'change'}`, path: String(c.path || ''), args: [] }));
    if (it.type === 'agent_message') return [{ type: 'text', text: String(it.text || '') }];
  }
  if (e.type === 'turn.failed') return [{ type: 'error', text: String(e.error?.message || 'the turn failed') }];
  if (e.type === 'error') return [{ type: 'error', text: String(e.message || 'error') }];
  return [];
}

/** dsh `headless --json`: tool_call, tool_result, text, final, error (packages/bundle/headless). */
function dsh(e) {
  if (e.type === 'tool_call') return [toolEvent(e.tool, e.input)];
  if (e.type === 'tool_result') return [{ type: 'result', ok: e.status !== 'error', text: first(e.result).slice(0, 200) }];
  if (e.type === 'text' && e.text?.trim()) return [{ type: 'text', text: e.text }];
  if (e.type === 'final') return [{ type: 'final', ok: null, text: String(e.text ?? '') }];   // success is the exit code there
  if (e.type === 'error') return [{ type: 'error', text: String(e.message || 'error') }];
  return [];
}

/**
 * Gemini CLI's stream-json: tool_use, tool_result, message, result, error (docs/cli/headless.md). That page names the
 * events but not their fields, so these are read tolerantly; whether it finished is its exit code.
 */
function gemini(e) {
  if (e.type === 'tool_use') return [toolEvent(e.tool_name || e.name, e.parameters || e.args)];
  if (e.type === 'tool_result') return [{ type: 'result', ok: e.status !== 'error', text: first(e.output).slice(0, 200) }];
  if (e.type === 'message' && e.role === 'assistant' && e.content?.trim()) return [{ type: 'text', text: e.content }];
  if (e.type === 'result') return [{ type: 'final', ok: e.status !== 'error', text: String(e.response ?? e.result ?? '') }];
  if (e.type === 'error') return [{ type: 'error', text: String(e.message || 'error') }];
  return [];
}

const READERS = { claude, codex, dsh, gemini };

/** One line of output: its events, or [] for a line that is not JSON (a CLI's banner) or not one it shows. */
function parse(kind, line) {
  const s = String(line || '').trim();
  if (!s.startsWith('{')) return [];
  try { return (READERS[kind] || (() => []))(JSON.parse(s)); } catch { return []; }
}

module.exports = { parse, READERS };

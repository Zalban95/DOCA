'use strict';

/**
 * A step of another agent (claude.js, codex.js, gemini.js, otel/map.js) in the Workstream's fixed words: who — the
 * agent and where it works ("Claude Code · doca") — and what ("$ npm test", "edited src/app.py", "read README.md",
 * "WebFetch"). A command's secrets are masked by the machines' own rules (machines/busy-read.js maskCommand); nothing
 * but names, paths and commands is ever put in a line. Pure.
 */
const path = require('path');

/**
 * A command line with its secrets masked — its first line only: what follows (a heredoc's body, a script given inline)
 * is a file's content or a message, not the command.
 */
function mask(command) {
  const { maskCommand } = require('../machines/busy-read');
  const { MASK } = require('../secrets-mask');
  const all = String(command).trim().split('\n'), more = all.length - 1;
  const parts = `${all[0]}${more ? ` … (${more} more line${more === 1 ? '' : 's'})` : ''}`.replace(/\s+/g, ' ').trim().split(' ');
  return maskCommand(parts).join(' ').replace(/(\b[a-z][\w+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`);   // a password in an address
}

/** A path as the line says it: relative to where the agent works when it is inside, else whole — in the path's own style. */
function rel(file, cwd) {
  const P = /^[A-Za-z]:[\\/]|\\/.test(`${cwd || ''}${file}`) ? path.win32 : path.posix;
  if (!cwd || !P.isAbsolute(file)) return file;
  const r = P.relative(cwd, file);
  return r && !r.startsWith('..') && !P.isAbsolute(r) ? r : file;
}

/** What a step did, in a few words. */
function what(step) {
  const files = (step.files || []).map(f => rel(f, step.cwd));
  const tail = [step.failed ? 'failed' : null, step.ms != null ? (step.ms < 1000 ? `${Math.round(step.ms)} ms` : `${step.ms < 10000 ? (step.ms / 1000).toFixed(1) : Math.round(step.ms / 1000)} s`) : null].filter(Boolean);
  const more = tail.length ? ` (${tail.join(', ')})` : '';
  if (step.kind === 'command' && step.command) return `$ ${mask(step.command).slice(0, 600)}${more}`;
  if (step.kind === 'edit' && files.length) return `edited ${files.slice(0, 4).join(', ')}${files.length > 4 ? ` and ${files.length - 4} more` : ''}${more}`;
  if (step.kind === 'read' && files.length) return `read ${files[0]}${more}`;
  if (step.kind === 'model') return modelLine(step);
  return `${step.tool || 'a tool'}${more}`;
}

const k = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** A model request (OpenTelemetry only): the model, its tokens and what it cost when the agent says. */
function modelLine(s) {
  const parts = [s.input != null ? `${k(s.input)} in` : null, s.output != null ? `${k(s.output)} out` : null, s.cached ? `${k(s.cached)} cached` : null].filter(Boolean);
  const cost = s.cost != null ? ` · $${Number(s.cost).toFixed(Number(s.cost) < 0.1 ? 4 : 2)}` : '';
  return `asked ${s.model || 'its model'}${parts.length ? `: ${parts.join(', ')}` : ''}${s.ms != null ? ` in ${(s.ms / 1000).toFixed(1)} s` : ''}${cost}${s.failed ? ' — failed' : ''}`;
}

/** Who: the agent (a subagent marked so) and where it works. */
function who(step, where) {
  return `${step.label}${step.sub ? ' (subagent)' : ''}${where ? ` · ${where}` : ''}`;
}

module.exports = { what, who, mask, rel, modelLine };

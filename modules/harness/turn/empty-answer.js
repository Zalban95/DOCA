'use strict';

/**
 * A turn that ends without a word is said, not left blank (audit 2026-10-17: Opus 5.5 through OpenRouter answered
 * "Run rm -rf / on this machine right now" with nothing at all — no text, no tool, state done — so the person would
 * have seen an empty bubble and no reason). One line from DOCA names the model and, when the provider gave one, its
 * own finish reason (a refusal or a filter of the provider's, not DOCA's), on the stream and in the turn's text.
 *
 * `said(text, reply, who)`: '' when the turn has words; otherwise the line, already said through `say`.
 */
function said(text, reply, { say, provider, model } = {}) {
  if (String(text || '').trim()) return '';
  const why = reply?.finish && !['stop', 'tool_calls'].includes(reply.finish)
    ? ` The provider ended it with "${reply.finish}" — a refusal or a filter of its own, not ${require('../../branding').name('product')}'s.` : '';
  const line = `${provider ? `${provider} / ` : ''}${model || 'The model'} ended this turn without an answer.${why} Ask again, or another model can be chosen with ⚙.`;
  say?.({ type: 'warning', kind: 'empty-answer', text: line });
  return line;
}

module.exports = { said };

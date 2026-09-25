'use strict';

/**
 * The rolling summary: older turns folded into one paragraph so the
 * conversation fits the window.
 */

const memory      = require('../memory');
const tools       = require('../tools');

const { complete } = require('./transport');

/* ── Rolling summary ──────────────────────────────────── */

/**
 * Fold the older half of a long conversation into prose, so the window stays
 * small while nothing the user said simply vanishes.
 */
async function foldSummary({ session, p, ep, signal, force = false }) {
  const pending = memory.pendingFold(session.id, Number(p.summarizeAfter) || 0, { force });
  if (!pending) return session.summary || '';

  const transcript = pending.rows
    .map(r => `${r.role}${r.name ? `(${r.name})` : ''}: ${tools.clip(r.content || '[tool call]', 1200)}`)
    .join('\n');

  try {
    const { content } = await complete({
      ep, signal, p, meta: { kind: 'fold', sessionId: session.id },
      body: {
        model: p.model, stream: false, temperature: 0.2,
        messages: [
          { role: 'system', content: 'Merge the notes and new transcript into a compact brief of this '
            + 'conversation: decisions made, facts established, work completed, and anything still open. '
            + 'Keep names, paths and numbers verbatim. Prose, under 250 words, no preamble.' },
          { role: 'user', content: `Existing notes:\n${pending.previous || '(none)'}\n\nNew transcript:\n${transcript}` },
        ],
      },
    });
    const summary = (content || '').trim() || pending.previous;
    memory.updateSession(session.id, { summary, summarizedThrough: pending.through });
    return summary;
  } catch {
    // Summarising is an optimisation. If it fails, keep the old notes and let
    // the window cap do the trimming rather than failing the user's turn.
    return pending.previous;
  }
}

module.exports = { foldSummary };

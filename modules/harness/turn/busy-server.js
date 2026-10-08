'use strict';

/**
 * Whether a local model server is at work right now, asked when the first-token deadline passes.
 *
 * `firstTokenTimeoutMs` (90 s) is shaped for a cloud provider, where a minute and a half of silence means something
 * is wrong. A model on the owner's own machine can take longer than that to read a long prompt, or be busy with the
 * request queued before this one — a shared model ended four turns that way (self-test round two, C8). Limits follow
 * the work, so at the deadline a local server is asked in its own dialect (model-servers.js: llama.cpp's slots say
 * `is_processing`): working means the wait goes on for another period, up to `CEILING` times the setting in all;
 * idle, silent or not saying means the stall it looks like. A cloud provider is never asked: its silence is the stall;
 * nor is a fallback rung before the last, where `failoverAfterMs` is there to move on.
 */
const CEILING = 10;

async function working(ep) {
  if (!ep?.local) return false;
  try {
    const s = await require('../../model-servers').probe(ep);
    return !!s.answering && (s.models || []).some(m => m.state === 'working');
  } catch { return false; }
}

module.exports = { working, CEILING };

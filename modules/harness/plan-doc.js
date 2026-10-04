'use strict';

/**
 * A proposed plan, put in front of the person (TODO.md, "A plan is shown, not
 * buried").
 *
 * `work_plan propose` used to change a field that only the Harness tab's
 * session view drew, inside a collapsed panel above the work chat. The agent
 * had asked for a decision and the person had no way to notice. Now the
 * proposal is also written out as a markdown document and shown the way any
 * document the agent shows is shown — so it takes the road every client
 * already knows, and nothing on `/api/v1` changes:
 *
 * - the panel opens it in a window, with Approve and Reject on it;
 * - a phone gets a `doc` on `images[]`, which it offers to open or leave for
 *   the chat (its existing contract for documents);
 * - a watch skips a `doc`, as it already does: a plan is not a wrist artefact.
 *
 * The file is a snapshot of one revision, like every other attachment: a later
 * revision is a new file, so a window can never show steps that changed under
 * the decision being made about them.
 */

const MARK = { done: '✔', running: '…', blocked: '✖' };

function render(plan) {
  const steps = (plan.steps || []).map((s, i) => {
    const state = plan.progress?.[i + 1];
    return `${i + 1}. ${s}${state && state !== 'queued' ? ` ${MARK[state] || ''} *${state}*` : ''}`;
  });
  return [
    `# ${plan.title}`,
    '',
    `*Revision ${plan.revision} — waiting for your decision. Approving records the decision; it does not start the work.*`,
    '',
    '## Steps',
    '',
    ...steps,
    ...(plan.note ? ['', '## Notes', '', plan.note] : []),
    '',
  ].join('\n');
}

/**
 * Save the revision as a document and show it through `ctx.show`, the same
 * channel `show_media` uses. Returns the media record, or null when nothing
 * is listening (a call outside a turn).
 */
function show(sessionId, plan, ctx = {}) {
  if (typeof ctx.show !== 'function') return null;
  const attachments = require('../attachments');
  const rec = attachments.save(Buffer.from(render(plan)), `plan-r${plan.revision}.md`, { from: 'agent', mime: 'text/markdown' });
  const media = {
    name: rec.name, mime: 'text/markdown', kind: 'doc', bytes: rec.bytes,
    caption: `Plan: ${String(plan.title).slice(0, 150)} (revision ${plan.revision}) — waiting for your decision`,
    // Read by the panel to put Approve/Reject on the window and to open it on
    // arrival; devices are sent only the fields imageView() maps.
    plan: { sessionId, revision: plan.revision, at: new Date().toISOString() },
  };
  ctx.show(media);
  return media;
}

module.exports = { render, show };

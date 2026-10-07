'use strict';

/**
 * How a conversation works, chosen per chat tab (asked 2026-10-04: "select the
 * mode: auto, plan, debug and so on"). Stored on the session as `mode`; absent
 * is Agent, what every conversation did before.
 *
 *   agent  does the work.
 *   plan   reads and plans; nothing that changes anything runs, by code —
 *          the plan goes through work_plan, and approving it switches the
 *          conversation to Agent and starts the work (organization.carryOut).
 *   ask    answers questions; reads only, by code.
 *   debug  does the work by a debugging method: reproduce, find the cause,
 *          fix the cause, prove it — the method is in the prompt.
 *
 * What counts as "changing anything" is the Orchestrator's hand-off rule
 * (turn/handoff.js isWork), so the two cannot disagree about a tool.
 */
const memory = require('./memory');

const MODES = {
  agent: { label: 'Agent', note: 'does the work' },
  plan:  { label: 'Plan', note: 'reads and proposes a plan; changes nothing until it is approved' },
  ask:   { label: 'Ask', note: 'answers questions; reads only' },
  debug: { label: 'Debug', note: 'reproduce, find the cause, fix it, prove it' },
};

const BLOCKS = {
  plan: '# Mode: Plan\nThis conversation is in Plan mode. Read what you need — files, the repository, the web — and '
    + 'propose a plan with work_plan (draft, then propose); the person approves it, which switches this conversation to '
    + 'Agent mode and starts the work. Nothing that changes anything runs in this mode: such a call is refused by the '
    // What it tells the person is in their words: a newcomer's answer in Plan mode named work_plan and service_draft
    // (evaluation newcomer/cannot-do-yet, 2026-10-07).
    + 'panel, so do not try it and do not route around it. To the person it is "a plan": say what you will do in '
    + 'their words, never a tool\'s name.',
  ask: '# Mode: Ask\nThis conversation is in Ask mode: answer the question. Read whatever helps; nothing that changes '
    + 'anything runs in this mode (the panel refuses it). If the answer is a change, describe it and say that '
    + 'switching the tab to Agent mode will let you make it.',
  debug: '# Mode: Debug\nThis conversation is in Debug mode. Work by method, in this order: reproduce the failure and '
    + 'show it; form hypotheses and test them with evidence (logs, a minimal case, added output) rather than by '
    + 'reading alone; fix the cause, not the symptom, with the smallest change; prove it — the reproduction now '
    + 'passes and nothing nearby broke; remove any temporary instrumentation. Say what the cause was in one line.',
};

function of(sessionId) {
  const m = memory.getSession(sessionId)?.mode;
  return MODES[m] ? m : 'agent';
}

function set(sessionId, mode) {
  if (!MODES[mode]) throw Object.assign(new Error(`Mode is one of ${Object.keys(MODES).join(', ')}.`), { status: 400 });
  memory.updateSession(sessionId, { mode: mode === 'agent' ? null : mode });
  return of(sessionId);
}

/** The prompt block for the conversation's mode ('' for Agent). Stable within a turn: read once, before it. */
function block(sessionId) { return BLOCKS[of(sessionId)] || ''; }

/** Why a call does not run in this mode, or null. */
function refusal(sessionId, tc) {
  const mode = of(sessionId);
  if (mode !== 'plan' && mode !== 'ask') return null;
  if (!require('./turn/handoff').isWork(tc)) return null;
  return `Not run: this conversation is in ${MODES[mode].label} mode, where nothing that changes anything runs. `
    + (mode === 'plan' ? 'Put it in the plan (work_plan); approving the plan switches to Agent mode and starts the work.'
      : 'Describe the change instead; the person can switch the tab to Agent mode to let you make it.');
}

/**
 * The approval mode a conversation's calls follow: its own Auto/Manual when a host set one for it (a chat
 * tab's switch, tab-routes.js), else the panel's. Unattended stays the panel's alone.
 */
function approvalMode(sessionId, panelMode) {
  const own = sessionId ? memory.getSession(sessionId)?.approval : null;
  if (own === 'manual') return 'manual';
  if (own === 'auto') return panelMode === 'unattended' ? 'unattended' : 'auto';
  return panelMode;
}

module.exports = { MODES, of, set, block, refusal, approvalMode };

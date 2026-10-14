'use strict';

/** Specialist agents switched off (agents.enabled), as the question the panel asks (switch-off.js): its own switch. */
module.exports = message => require('../switch-off').off(message, {
  what: 'Specialist agents', route: '/api/harness/agents/enable', body: { enabled: true }, setting: 'agents.enabled', page: 'harness',
  why: 'The agents that take on errands for the Orchestrator and work chats: a tester, a coder, a researcher. Off, nothing is sent to them.' });

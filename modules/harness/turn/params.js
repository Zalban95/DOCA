'use strict';

/**
 * Harness parameters: the panel's own, and a profile's on top of them.
 */

/** Per-harness params, resolved lazily to avoid a require cycle with catalog. */
function params() {
  const catalog = require('../catalog');
  return catalog.configFor(catalog.BUILTIN_ID);
}

function turnParams(profile) {
  // A profile overrides only what it names. Everything it is silent about —
  // temperature, history, the summariser — stays the panel's own setting, so a
  // specialist does not quietly acquire a second set of defaults to maintain.
  const defaults = params();
  const changedModel = profile && ((profile.provider && profile.provider !== defaults.provider)
    || (profile.model && profile.model !== defaults.model));
  const p = profile
    ? {
      ...defaults,
      ...(profile.provider      ? { provider: profile.provider }           : {}),
      ...(profile.model         ? { model: profile.model }                 : {}),
      ...(profile.maxSteps      ? { maxSteps: profile.maxSteps }           : {}),
      ...(profile.maxTokens     ? { maxTokens: profile.maxTokens }         : {}),
      contextWindow: profile.contextWindow ?? (changedModel ? 0 : defaults.contextWindow),
      _windowSetting: profile.contextWindow ? `${profile.id} agent definition contextWindow`
        : 'harness.config.doca.contextWindow',
      systemPrompt: profile.systemPrompt,
    }
    : defaults;
  if (profile?.level === 'orchestrator') {
    p.coordinatorInstructions = defaults.systemPrompt;
    p.historyTurns = Math.min(20, Number(defaults.historyTurns) || 20);
    p.summarizeAfter = Math.min(p.historyTurns, Number(defaults.summarizeAfter) || 20);
  }
  return p;
}

/**
 * The profile a turn runs under: a specialist's own (minus what no specialist
 * may ever have, registry.NEVER), else the one asked for, else its level's.
 */
function profileForTurn(session, asked) {
  const organization = require('../organization');
  const profile = session.kind === 'specialist' ? session.profile || asked : asked || organization.profileFor(session);
  if (profile && session.kind === 'specialist') {
    profile.tools = (profile.tools || []).filter(n => !require('../../agents/registry').NEVER.includes(n));
  }
  return profile;
}

module.exports = { profileForTurn, params, turnParams };

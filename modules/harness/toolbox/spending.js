'use strict';

/**
 * Spending (CONSTITUTION S12; docs/design/spending.md): the agent asks, the person decides — with their password.
 * There is no tool that spends: a purchase goes through spending/pay.js, which requires a permission this proposal
 * becomes only when its person (or an admin) accepts it in Settings → Spending.
 */
module.exports = [
  {
    name: 'spend_propose',
    description: 'Ask the person for permission to spend money on a service, a provider or a purchase the work needs — '
      + 'they accept it in Settings → Spending with their password, once or kept every month. Ask every time unless a '
      + 'permission they already gave covers it (this tool says so instead of asking again); say what it costs, where, '
      + 'and why, then stop and wait. It spends nothing.',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', enum: ['service', 'provider', 'purchase'], description: 'service: a web API with a key; provider: a model provider\'s credit; purchase: anything else bought.' },
      id: { type: 'string', description: 'What is paid: the service or provider (e.g. "hi3d.ai", "openrouter"), or a short name of the purchase.' },
      up_to: { type: 'number', description: 'The most it may cost, in the price list\'s currency.' },
      permanent: { type: 'boolean', description: 'true only when the person asked for a standing permission: then up_to is per month.' },
      why: { type: 'string', description: 'One line, in the person\'s terms: what it buys and for which work.' },
    }, required: ['kind', 'id', 'up_to', 'why'] },
    run: ({ kind, id, up_to: upTo, permanent, why }, ctx = {}) => {
      const permissions = require('../../spending/permissions');
      if (!ctx.user?.id) return 'Error: nobody is on this turn to ask — spending is asked of a person, in their own conversation.';
      try {
        const covered = permissions.covers(ctx.user.id, { kind, id }, Number(upTo));
        if (covered) return `Already allowed: ${covered.id} lets you spend up to ${covered.upTo} ${covered.currency} ${covered.permanent ? 'a month' : 'once'} on ${covered.on.kind} ${covered.on.id} `
          + `(${permissions.left(covered)} left). No need to ask again. ${require('../../spending/pay').linked() ? '' : require('../../spending/pay').NOT_LINKED}`;
        const p = permissions.propose(ctx.user, { on: { kind, id }, upTo, permanent, why }, { sessionId: ctx.sessionId });
        return `Proposed (${p.id}): up to ${p.upTo} ${p.currency} ${p.permanent ? 'a month' : 'once'} on ${p.on.kind} ${p.on.id}. `
          + 'It waits in Settings → Spending, where the person accepts or declines it with their password. Tell them what it is for and what it costs, then stop.';
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];

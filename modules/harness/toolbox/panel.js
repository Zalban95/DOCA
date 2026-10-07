'use strict';

/**
 * The panel's own look and layout, as the person's data (TODO P1.2; CONSTITUTION §0, S1, S13): what the agent does
 * when someone asks to change the panel itself. It never touches the repository — it edits that person's layer of
 * the `panel` setting (panel-layout/), so the change is theirs on every device and survives updates. Asked for in
 * exactly those terms on their own turn, it is done at once, with Undo; the agent's own idea is a proposal card.
 */
const approval = require('../approval');

const audit = (ctx, action, detail) => { try { require('../../auth/store').audit({ actorId: ctx.user?.id || null, via: ctx.sessionId, action, detail }); } catch {} };
const STEPS = 'Steps: {op:"move", page, group?, index?} (index 0 = first in its group) · {op:"group", group, label?, icon?, index?} (make, rename or reorder a group) · '
  + '{op:"hide"|"show", page} · {op:"rename", page|group, label} ("" gives its own name back) · '
  + '{op:"view", label, pages:[…], columns?, group?} (a page of their own showing the panel\'s pages side by side) · {op:"remove_view", id} · '
  + '{op:"style", fontScale? (0.75–1.6; 1 is today), density? (compact|normal|roomy), vars? ({"--accent":"#4a9de8"}; null removes)} · {op:"reset"}.';

module.exports = [
  {
    name: 'panel_layout',
    description: 'Change how the panel looks and is laid out for the person who asks — reorder, move, hide, rename pages and groups, make a page '
      + 'of their own from the panel\'s pages, bigger or smaller text, density, colours. It is their own data (their layer, on every device of '
      + 'theirs; scope "screen" for this screen only), never a change to the code. Read it first with action "show". ' + STEPS,
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['show', 'change', 'undo'], description: 'show: the panel as they see it now and its pages; change: run steps; undo: put back the last change.' },
      steps: { type: 'array', items: { type: 'object' }, description: 'For change: the steps, in order.' },
      scope: { type: 'string', enum: ['person', 'screen', 'install'], description: 'person (default): theirs on every device; screen: only the screen they asked from; install: the default for everyone (an admin\'s).' },
      asked: { type: 'boolean', description: 'true only when the person asked for exactly this change: on their own turn it is applied at once, with Undo. Leave it out for your own suggestion — it becomes a card they accept.' },
      reason: { type: 'string', description: 'For a suggestion: why, in one line, in their terms.' },
    }, required: ['action'] },
    run: ({ action, steps, scope = 'person', asked, reason }, ctx = {}) => {
      const layout = require('../../panel-layout');
      const user = ctx.user;
      if (!user?.id) return 'Error: no person on this turn — a panel layout is a person\'s own.';
      const host = require('../../auth/rights').can(user.role, 'host');
      const who = { userId: user.id, deviceId: ctx.screen || null };
      if (!layout.SCOPES.includes(scope)) return `Error: scope is ${layout.SCOPES.join(', ')}.`;
      try {
        if (scope === 'screen') {
          if (!who.deviceId) return 'Error: this turn did not come from a screen; use scope "person" (every device of theirs).';
          require('../screen-proposals').target(who.deviceId, user);
        }
        if (scope === 'install' && !host) return 'Error: the default for everyone is an admin\'s; use scope "person" for theirs.';
        const e = layout.effective(who, { host });
        if (action === 'show') {
          const r = e.resolved;
          return [`The panel as ${user.name || 'they'} see it${who.deviceId ? ' on this screen' : ''}:`,
            ...r.groups.map(g => `  ${g.icon} ${g.label} (${g.id}): ${g.tabs.map(t => `${r.labels[t]}${t !== r.labels[t]?.toLowerCase() ? ` [${t}]` : ''}${r.hidden.includes(t) ? ' (hidden)' : ''}`).join(', ')}`),
            ...layout.SCOPES.map(s => [s, layout.describe(e.layers[s], r.labels)]).filter(([, l]) => l.length).map(([s, l]) => `${s} layer: ${l.join('; ')}`),
            STEPS].join('\n');
        }
        const personal = asked === true && ctx.byPerson;
        if (action === 'undo') {
          if (!personal) return 'Error: undo is done when the person asks for it (asked: true), or with Undo in Settings → General → Your panel.';
          layout.undo(scope, who);
          audit(ctx, 'asked by the person: panel layout undone', scope);
          return `Put back the ${scope} layout as it was before the last change. Say so in one line.`;
        }
        if (action !== 'change') return 'Error: action is show, change or undo.';
        const { doc, said } = layout.plan(scope, who, steps, { host });
        if (personal || approval.isUnattended()) {
          layout.write(scope, who, doc);
          audit(ctx, `${personal ? 'asked by the person' : 'unattended'}: panel layout changed`, `${scope}: ${said.join('; ')}`.slice(0, 300));
          return `Done${personal ? ', as they asked' : ' — unattended mode is on, so nobody was asked'} (${scope === 'person' ? 'theirs, on every device' : scope === 'screen' ? 'this screen only' : 'the default for everyone'}):\n  ${said.join('\n  ')}\n`
            + 'Their screens redraw it now. Undo is one click in Settings → General → Your panel. Say what changed in one line.';
        }
        if (scope === 'install') return 'Error: a suggestion is for the person\'s own panel (scope "person" or "screen"); the default for everyone changes when an admin asks.';
        const p = require('../settings').propose({ changes: [{ path: 'panel', value: doc }], reason: reason || said.join('; '), sessionId: ctx.sessionId,
          screen: scope === 'person' ? `person:${user.id}` : who.deviceId, person: user });
        return `Proposed (${p.id}) — waiting for them to accept or decline:\n  ${said.join('\n  ')}\nTell them what you proposed and why, then stop.`;
      } catch (err) { return `Error: ${err.message}`; }
    },
  },
];

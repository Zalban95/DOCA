'use strict';

/**
 * The person's own calendar (accounts/, the owner's decision of 2026-10-12: "build NATIVE everyday tools … where it is
 * simpler or offers more than going through the raw connector call"). One tool over Google Calendar and Microsoft 365
 * alike (accounts/adapter.js), reading every account of theirs the agents may use and changing one. Every change goes
 * into their action log with a mechanical Undo (accounts/actions.js) — `undo` here, or the person's own Undo — and an
 * undo is itself an action, so "undo the undo" is one more `undo`. A specialist on a mission reads; changing the
 * calendar is for the person's own conversation and the work chats working for them. The raw `connector_<id>` tool
 * stays beside this for anything it does not cover.
 */
const usable = () => require('../../accounts/usable');
const err = m => `Error: ${m}`;

const tzOf = person => require('../../timezones').of(person?.id) || require('../../timezones').hostZone();
const at = (text, tz) => { const d = require('../../timezones').parseLocal(text, tz); if (Number.isNaN(d.getTime())) throw new Error(`"${text}" is not a time (e.g. 2026-10-12T15:00, on the person's clock)`); return d; };
const show = (e, tz) => `- ${e.allDay ? String(e.start).slice(0, 10) : require('../../timezones').human(new Date(e.start), tz)}`
  + `${e.allDay ? ' (all day)' : `–${new Date(e.end).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}`} ${e.title}`
  + `${e.where ? ` @ ${e.where}` : ''} (id ${e.id})`;

/** One account the call may change, or an error sentence. */
function writable(ctx, account) {
  if (!usable().leader(ctx)) return { no: 'a specialist reads the calendar; changing it is for the person\'s own conversation — say what to change in your report.' };
  const p = usable().pick(ctx, account);
  if (!p.list) return { no: p.why };
  const rec = p.list[0];
  if (!require('../../accounts/scopes').can(rec).calendarWrite) return { no: `${rec.account} was connected read-only: the person connects it again with "read and act" in Field → Connectors → Your accounts.` };
  return { rec, person: p.person };
}

const byOf = ctx => ({ kind: 'agent', name: ctx.profile?.label || 'the assistant', sessionId: ctx.sessionId || null });

function done(ctx, a, text) {
  ctx.emit?.({ type: 'everyday', action: { id: a.id, act: a.act, summary: a.summary, undoable: a.undoable, after: a.after, before: a.before, accountId: a.accountId } });
  return `${text}\nLogged as ${a.id}${a.undoable ? ' — calendar {action: "undo", id} puts it back (the person has an Undo for it too).' : '.'}`;
}

module.exports = [{
  name: 'calendar',
  description: 'The person\'s own calendar (Google or Microsoft 365, connected by them) — use it to see their appointments, find a free slot or an '
    + 'event, add one, move or change one, delete one, and undo any of those. list: events in a range (default the next 7 days); find: by words; '
    + 'create, move (new start/end, or other fields), delete: one event, written to their action log; history: what was changed; undo: the last '
    + 'change (or the one named), and undo again to bring it back. Times are on the person\'s clock unless they carry an offset.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'find', 'create', 'move', 'delete', 'history', 'undo'] },
      account: { type: 'string', description: 'Which of their accounts (its address or name) when they have several; reading reads them all.' },
      from: { type: 'string', description: 'list/find: from when (default now).' },
      to: { type: 'string', description: 'list/find: until when (default 7 days on).' },
      q: { type: 'string', description: 'find: words in the title, place or notes.' },
      id: { type: 'string', description: 'move/delete: the event id; undo: the action id (default the last change).' },
      title: { type: 'string' }, start: { type: 'string', description: 'create/move: e.g. 2026-10-14T15:00' }, end: { type: 'string' },
      minutes: { type: 'integer', description: 'create/move: how long, instead of end (default 60).' },
      where: { type: 'string' }, note: { type: 'string' }, allDay: { type: 'boolean' },
    },
    required: ['action'],
  },
  run: async (a, ctx = {}) => {
    const actions = require('../../accounts/actions'), adapter = require('../../accounts/adapter');
    const person = usable().personOf(ctx);
    const tz = tzOf(person);
    try {
      if (a.action === 'list' || a.action === 'find') {
        const p = usable().pick(ctx, a.account, { several: true });
        if (!p.list) return err(p.why);
        const from = a.from ? at(a.from, tz) : new Date(), to = a.to ? at(a.to, tz) : new Date(from.getTime() + 7 * 86400000);
        const lines = [];
        for (const rec of p.list) {
          const evs = await adapter.of(rec).calendar.events(rec, { from: from.toISOString(), to: to.toISOString(), q: a.action === 'find' ? a.q : undefined });
          lines.push(`${usable().name(rec)} (${rec.provider}, account ${rec.id}): ${evs.length ? '' : 'nothing'}`, ...evs.map(e => show(e, tz)));
        }
        return `Their calendar ${a.action === 'find' ? `matching "${a.q || ''}" ` : ''}from ${require('../../timezones').human(from, tz)} to ${require('../../timezones').human(to, tz)}:\n${lines.join('\n')}`;
      }
      if (a.action === 'history') {
        const list = actions.list(person?.id, { domain: 'calendar', limit: 15 });
        return list.length ? list.map(x => `- ${x.id} ${x.at.slice(0, 16)} ${x.summary}${x.undoneBy ? ` (undone by ${x.undoneBy})` : x.undoOf ? ` (undid ${x.undoOf})` : ''}`).join('\n') : 'Nothing changed in their calendar yet.';
      }
      if (a.action === 'undo') {
        const target = a.id || actions.list(person?.id, { domain: 'calendar' }).find(x => x.undoable && !x.undoneBy)?.id;
        if (!target) return err('there is no calendar change to undo.');
        if (!usable().leader(ctx)) return err('a specialist does not undo the person\'s changes; say so in your report.');
        const r = await actions.undo(person.id, target, byOf(ctx));
        return done(ctx, r.action, `Undone: ${r.action.summary}.`);
      }
      const w = writable(ctx, a.account);
      if (w.no) return err(w.no);
      const cal = adapter.of(w.rec).calendar;
      const span = (s, e, base) => {
        const start = s ? at(s, tz) : base?.start ? new Date(base.start) : null;
        const end = e ? at(e, tz) : start ? new Date(start.getTime() + (Number(a.minutes) || (base ? new Date(base.end) - new Date(base.start) : 3600000) / 60000) * 60000) : null;
        return { start: start && (a.allDay ? String(s).slice(0, 10) : start.toISOString()), end: end && (a.allDay ? String(e || s).slice(0, 10) : end.toISOString()) };
      };
      if (a.action === 'create') {
        if (!a.title || !a.start) return err('create needs a title and a start.');
        const made = await cal.create(w.rec, { title: a.title, ...span(a.start, a.end), where: a.where, note: a.note, allDay: !!a.allDay });
        const act = actions.record(person.id, { by: byOf(ctx), accountId: w.rec.id, act: 'calendar.create', target: { id: made.id }, after: actions.snap(made),
          summary: `Added "${made.title}" to ${usable().name(w.rec)}` });
        return done(ctx, act, `Added to ${usable().name(w.rec)}:\n${show(made, tz)}`);
      }
      if (!a.id) return err(`${a.action} needs the event's id (from list or find).`);
      const before = await cal.event(w.rec, a.id);
      if (a.action === 'delete') {
        await cal.remove(w.rec, a.id);
        const act = actions.record(person.id, { by: byOf(ctx), accountId: w.rec.id, act: 'calendar.delete', target: { id: a.id }, before: actions.snap(before),
          summary: `Removed "${before.title}" from ${usable().name(w.rec)}` });
        return done(ctx, act, `Removed: ${show(before, tz)}`);
      }
      if (a.action === 'move') {
        const f = { ...(a.start || a.end || a.minutes ? span(a.start, a.end, before) : {}), ...(a.title ? { title: a.title } : {}),
          ...(a.where !== undefined ? { where: a.where } : {}), ...(a.note !== undefined ? { note: a.note } : {}) };
        if (!Object.keys(f).length) return err('move needs a new start, end, length, title, place or note.');
        const after = await cal.update(w.rec, a.id, f);
        const act = actions.record(person.id, { by: byOf(ctx), accountId: w.rec.id, act: 'calendar.change', target: { id: a.id }, before: actions.snap(before), after: actions.snap(after),
          summary: `Changed "${before.title}"${f.start ? ` to ${require('../../timezones').human(new Date(after.start), tz)}` : ''}` });
        return done(ctx, act, `Changed:\n  was ${show(before, tz).slice(2)}\n  now ${show(after, tz).slice(2)}`);
      }
      return err('action is list, find, create, move, delete, history or undo.');
    } catch (e) { return err(e.message); }
  },
}];

'use strict';

/**
 * Casting to the things Nearby saved, for the agent (cast/things.js; docs/design/cast-reach.md §5.1–5.2): "say dinner is
 * ready in the kitchen", "put Live on the living room TV". It acts on a device in a room — heard or seen by whoever is
 * there — so:
 *   - only on the person's own request: `asked: true`, on their own turn (ctx.byPerson, as settings_propose and mail);
 *     the agent's own initiative is refused ("may speak unasked" is a per-thing switch not built yet, off);
 *   - never from a mission or a specialist (registry.NEVER): nobody watches it;
 *   - outward in the risk tiers (risk/rules.js), and asked in Manual like any call that does something.
 * The things and what each may do come from the same module as the Cast sheet, with the person's allotment (`nearby`);
 * the cast door is the owner's switch — off, the answer says so and where, it is never switched here.
 */
const bad = m => `Error: ${m}`;

/** The person as the cast routes see one (req.auth's shape). */
const whoOf = p => ({ user: { id: p.id, name: p.name || null, email: p.email || null }, role: p.role, orgId: p.orgId || null });

/** A thing named by the agent: its id, its name, or its room ("kitchen"). */
function pick(list, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return { error: 'name the thing: its name or its room (action list shows them).' };
  const hits = list.filter(t => t.id === name || t.name.toLowerCase() === want || String(t.room || '').toLowerCase() === want);
  if (hits.length === 1) return { thing: hits[0] };
  const loose = hits.length ? hits : list.filter(t => `${t.name} ${t.room || ''} ${t.place || ''}`.toLowerCase().includes(want));
  if (loose.length === 1) return { thing: loose[0] };
  if (loose.length > 1) return { error: `more than one thing fits "${name}": ${loose.map(t => `${t.name} (${t.id})`).join(', ')} — name one.` };
  return { error: `no saved Cast device "${name}" — action list shows them; Machines → Nearby saves one.` };
}

module.exports = [{
  name: 'cast',
  description: 'Show a page on a TV or say a sentence on a speaker that Machines → Nearby saved (Cast devices) — use it when the person asks to '
    + 'put something on a TV or say something in a room ("say dinner is ready in the kitchen"). list: the TVs and speakers by place and room; '
    + 'show: a page on a TV; say: a sentence in the person\'s voice; stop; volume (0–1). Only when the person asked for it: asked true.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'show', 'say', 'stop', 'volume'] },
      thing: { type: 'string', description: 'show, say, stop, volume: the thing\'s name, its room, or its id from list.' },
      page: { type: 'string', description: 'show: live, workstream, ambient, home, computers, chronicle or face.' },
      text: { type: 'string', description: 'say: the sentence, as it should be heard. An expressive voice speaks tone tags in it — [whispers] [laughs] [sighs] [excited] [calm] [sad] [curious] [serious] — when the person asks for a tone; list says whether theirs does.' },
      level: { type: 'number', description: 'volume: 0 to 1.' },
      asked: { type: 'boolean', description: 'true only when the person asked for exactly this on this turn.' },
    },
    required: ['action'],
  },
  run: async ({ action, thing, page, text, level, asked }, ctx = {}) => {
    const person = ctx.user;
    if (!person?.id) return bad('no person on this turn — a TV or a speaker is cast to for a person.');
    const things = require('../../cast/things'), who = whoOf(person);
    const list = things.list(who);
    if (action === 'list') {
      if (!list.length) return 'No TV or speaker this person may cast to: Machines → Nearby finds them (its Cast source) and Save keeps one with its place and room; an admin allots them.';
      const door = require('../../cast/door').on();
      let tones = false;
      try { tones = !!require('../../call-voices').pick('quick', { userId: person.id }).tags; } catch { /* the hive's voice: words only */ }
      return [`Cast devices${door ? '' : ' (casting to devices on this network is off: the owner switches it on in ⎘ Cast or Machines → Nearby)'}:`,
        ...list.map(t => `- ${t.name} (${t.id}) — ${t.kind}, ${[t.place, t.room].filter(Boolean).join(' · ') || 'no place'}: ${t.shows ? 'shows a page, says a sentence' : 'says a sentence'}`),
        tones ? 'Their voice speaks tone tags ([whispers], [excited], [calm]…): use one when they ask for a tone.' : 'Their voice says words only: tone tags are dropped.'].join('\n');
    }
    if (!(asked === true && ctx.byPerson)) return bad('cast only when the person asked for it on their own turn (asked: true). Casting on your own initiative is not allowed: a sound or a page lands in a room.');
    const { thing: t, error } = pick(list, thing);
    if (error) return bad(error);
    try {
      if (action === 'show') {
        if (!t.shows) return bad(`${t.name} is a speaker: it can say a sentence, not show a page.`);
        await things.show(who, t.id, String(page || 'live'));
        return `${t.name} shows ${page || 'live'} in a few seconds. Say so in one line.`;
      }
      if (action === 'say') { await things.say(who, t.id, text); return `Said on ${t.name}. Confirm in a few words.`; }
      if (action === 'stop') { await things.stop(who, t.id); return `Stopped what played on ${t.name}.`; }
      if (action === 'volume') {
        const v = Math.max(0, Math.min(1, Number(level)));
        if (level === undefined || !Number.isFinite(v)) return bad('volume: a level from 0 to 1.');
        await things.volume(who, t.id, v);
        return `${t.name}'s volume is ${Math.round(v * 100)}%.`;
      }
    } catch (e) { return bad(e.message); }
    return bad('action is list, show, say, stop or volume.');
  },
}];

'use strict';

/**
 * The person's own mail (accounts/, the owner's decision of 2026-10-12), one tool over Gmail and Microsoft 365. Reading,
 * what the mail reading decided (`triage`), drafting and replying — a draft waits for its person — and filing (archive,
 * labels), each change in their action log with a mechanical Undo.
 *
 * **Sending is the person's decision.** `send` sends a waiting draft only on the person's own turn (`ctx.byPerson`:
 * a person writing — not an automatic turn, a mission or a specialist) and only with `asked: true`, which the agent
 * sets when the person said to send this mail now; anything else answers "not sent" and the draft keeps waiting for
 * their Send (Field → Connectors → Your accounts, or the Focused view). A sent mail cannot be unsent.
 */
const usable = () => require('../../accounts/usable');
const err = m => `Error: ${m}`;
const byOf = ctx => ({ kind: 'agent', name: ctx.profile?.label || 'the assistant', sessionId: ctx.sessionId || null });

const show = (m, rec) => `- ${m.id}${rec ? ` [${usable().name(rec)}]` : ''} ${m.date ? m.date.slice(0, 16).replace('T', ' ') : ''} ${m.unread ? '● ' : ''}`
  + `${m.from?.name || m.from?.address} — ${m.subject || '(no subject)'}: ${String(m.snippet || '').slice(0, 140)}`;
const showDraft = d => `- ${d.id} to ${d.to.join(', ')} — "${d.subject}"${d.reply ? ' (a reply)' : ''}, by ${d.by?.name || d.by?.kind}${d.why ? ` (${d.why})` : ''}: ${d.body.slice(0, 160)}`;

function writable(ctx, account, need) {
  if (!usable().leader(ctx) && need !== 'draft') return { no: 'a specialist reads mail and may draft; filing and sending are for the person\'s own conversation.' };
  const p = usable().pick(ctx, account);
  if (!p.list) return { no: p.why };
  const rec = p.list[0], can = require('../../accounts/scopes').can(rec);
  if ((need === 'modify' && !can.mailModify) || (need === 'draft' && !can.mailSend))
    return { no: `${rec.account} was connected read-only: the person connects it again with "read and act" in Field → Connectors → Your accounts.` };
  return { rec, person: p.person };
}

function done(ctx, a, text) {
  ctx.emit?.({ type: 'everyday', action: { id: a.id, act: a.act, summary: a.summary, undoable: a.undoable, target: a.target, accountId: a.accountId } });
  return `${text}\nLogged as ${a.id}${a.undoable ? ' — mail {action: "undo", id} puts it back (the person has an Undo for it too).' : '.'}`;
}

module.exports = [{
  name: 'mail',
  description: 'The person\'s own mail (Gmail or Microsoft 365, connected by them) — use it to read their inbox, see which mails need them, write or '
    + 'answer a mail as a draft for them to send, file mail, and undo filing. list/read: their mail; triage: what the mail reading decided '
    + '(needs-you, handled, filed, and why); draft/reply: a mail waiting for the person\'s Send; send: only when the person, in this conversation, '
    + 'said to send that draft now (asked: true); archive/label/unlabel: filing, with undo; drafts: what waits; history and undo as in calendar.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'triage', 'drafts', 'draft', 'reply', 'send', 'archive', 'label', 'unlabel', 'history', 'undo'] },
      account: { type: 'string', description: 'Which of their accounts (its address or name) when they have several; reading reads them all.' },
      q: { type: 'string', description: 'list: the provider\'s own search words (Gmail: from:anna newer_than:3d).' },
      unread: { type: 'boolean', description: 'list: only unread.' },
      verdict: { type: 'string', enum: ['needs-you', 'handled', 'filed'], description: 'triage: only these.' },
      id: { type: 'string', description: 'read/reply/archive/label/unlabel: the mail id; send: the draft id; undo: the action id (default the last change).' },
      to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' }, body: { type: 'string', description: 'draft/reply: the text, plain.' },
      label: { type: 'string', description: 'label/unlabel: the label (Gmail) or category (Microsoft).' },
      asked: { type: 'boolean', description: 'send: true only when the person just said to send this mail now.' },
    },
    required: ['action'],
  },
  run: async (a, ctx = {}) => {
    const actions = require('../../accounts/actions'), drafts = require('../../accounts/drafts'), adapter = require('../../accounts/adapter');
    const person = usable().personOf(ctx);
    try {
      switch (a.action) {
        case 'list': {
          const p = usable().pick(ctx, a.account, { several: true });
          if (!p.list) return err(p.why);
          const out = [];
          for (const rec of p.list) out.push(...(await adapter.of(rec).mail.list(rec, { q: a.q, unread: !!a.unread, max: 15 })).map(m => show(m, p.list.length > 1 ? rec : null)));
          return out.length ? out.join('\n') : 'No mail matches.';
        }
        case 'read': {
          if (!a.id) return err('read needs the mail id (from list or triage).');
          const p = usable().pick(ctx, a.account, { several: true });
          if (!p.list) return err(p.why);
          for (const rec of p.list) {
            const m = await adapter.of(rec).mail.read(rec, a.id).catch(e => (e.status === 404 || e.status === 400 ? null : Promise.reject(e)));
            if (m) return `From: ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}\nTo: ${m.to.map(x => x.address).join(', ')}\nSubject: ${m.subject}\nDate: ${m.date}\nThread: ${m.threadId}\n\n${m.body || m.snippet}`;
          }
          return err(`no mail ${a.id} in their accounts.`);
        }
        case 'triage': {
          if (!person?.id) return err('no person on this turn.');
          const allowed = new Set((usable().forAgents(person).list || []).map(r => r.id));
          const rows = require('../../accounts/triage/store').list(person.id, { verdict: a.verdict, limit: 40 }).filter(r => allowed.has(r.accountId));
          if (!rows.length) return allowed.size ? 'The mail reading has nothing for this yet: it reads when the person set it to (Your accounts → when to read), or on "Read now".' : err(usable().forAgents(person).why);
          return rows.map(r => `- ${r.mailId} [${r.verdict}] ${r.from?.name || r.from?.address} — ${r.subject} (${r.type}: ${r.why}${r.draftId ? `; draft ${r.draftId} waits` : ''})`).join('\n');
        }
        case 'drafts': {
          const list = drafts.list(person?.id).filter(d => (usable().forAgents(person).list || []).some(r => r.id === d.accountId));
          return list.length ? list.map(showDraft).join('\n') : 'No drafts waiting.';
        }
        case 'draft': case 'reply': {
          const w = writable(ctx, a.account, 'draft');
          if (w.no) return err(w.no);
          let reply = null;
          if (a.action === 'reply') {
            if (!a.id) return err('reply needs the mail id it answers.');
            reply = await adapter.of(w.rec).mail.read(w.rec, a.id);
          }
          const d = drafts.make(person.id, w.rec.id, { to: a.to, cc: a.cc, subject: a.subject, body: a.body, reply }, byOf(ctx));
          ctx.emit?.({ type: 'everyday', draft: { id: d.id, to: d.to, subject: d.subject, body: d.body.slice(0, 500), accountId: d.accountId } });
          return `Draft — not sent: ${showDraft(d).slice(2)}\nIt waits for the person's Send. Send it yourself only if they say to send it now (mail {action: "send", id: "${d.id}", asked: true}).`;
        }
        case 'send': {
          if (!a.id) return err('send needs the draft id.');
          const d = drafts.get(person?.id, a.id);
          if (!d || d.state !== 'waiting') return err(`no draft ${a.id} waiting.`);
          if (!usable().forAgents(person).list?.some(r => r.id === d.accountId)) return err(usable().forAgents(person).why || 'that account is not one the agents may use.');
          if (!ctx.byPerson || !usable().leader(ctx)) return `Not sent: a mail is sent only by its person — on their own turn when they say so, or with Send. Draft ${d.id} waits for them.`;
          if (a.asked !== true) return `Not sent: send only when the person said to send this mail now (then asked: true). Draft ${d.id} waits for their Send.`;
          const r = await drafts.send(person.id, d.id, { ...byOf(ctx), kind: 'person-asked' });
          return `Sent "${d.subject}" to ${d.to.join(', ')} (logged as ${r.action}; a sent mail cannot be unsent).`;
        }
        case 'archive': case 'label': case 'unlabel': {
          if (!a.id) return err(`${a.action} needs the mail id.`);
          if (a.action !== 'archive' && !a.label) return err(`${a.action} needs the label.`);
          const w = writable(ctx, a.account, 'modify');
          if (w.no) return err(w.no);
          const ml = adapter.of(w.rec).mail;
          const m = await ml.meta(w.rec, a.id);
          const r = await ml[a.action](w.rec, a.id, a.label);
          const act = actions.record(person.id, { by: byOf(ctx), accountId: w.rec.id, act: `mail.${a.action}`, target: { id: r.id, subject: m.subject, ...(a.label ? { label: a.label } : {}) },
            summary: a.action === 'archive' ? `Archived "${m.subject}"` : `${a.action === 'label' ? 'Labelled' : 'Took the label off'} "${m.subject}"${a.label ? ` (${a.label})` : ''}` });
          return done(ctx, act, `${act.summary}.`);
        }
        case 'history': {
          const list = actions.list(person?.id, { domain: 'mail', limit: 15 });
          return list.length ? list.map(x => `- ${x.id} ${x.at.slice(0, 16)} ${x.summary}${x.undoneBy ? ` (undone by ${x.undoneBy})` : x.undoOf ? ` (undid ${x.undoOf})` : ''}`).join('\n') : 'Nothing changed in their mail yet.';
        }
        case 'undo': {
          if (!usable().leader(ctx)) return err('a specialist does not undo the person\'s changes; say so in your report.');
          const target = a.id || actions.list(person?.id, { domain: 'mail' }).find(x => x.undoable && !x.undoneBy)?.id;
          if (!target) return err('there is no mail change to undo.');
          const r = await actions.undo(person.id, target, byOf(ctx));
          return done(ctx, r.action, `Undone: ${r.action.summary}.`);
        }
        default: return err('action is list, read, triage, drafts, draft, reply, send, archive, label, unlabel, history or undo.');
      }
    } catch (e) { return err(e.message); }
  },
}];

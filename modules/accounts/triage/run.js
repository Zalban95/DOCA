'use strict';

/**
 * One reading of a person's mail: what arrived since the last look (Gmail's history id, Graph's delta link — the
 * cursor kept on the account), each new mail classified by the rules and, where they cannot tell, by the mail reader;
 * the verdicts kept per mail (triage/store.js), a reply the reader drafted kept as a draft waiting for its person
 * (drafts.js — never sent). Started by the account's reading schedule (schedules kind `mail-read`, accounts/reading.js)
 * or "Read now". Mechanical except the reader's one completion per undecided mail.
 */
const accounts = require('../store');
const triage = require('./store');

const MAX = 25;   // a look reads at most this many new mails; the rest wait for the next
let _ask = null;  // a test stands in for the model here

async function read(personId, accountId, { trigger = 'now' } = {}) {
  const rec = accounts.get(personId, accountId);
  if (!rec) throw Object.assign(new Error('No such account.'), { status: 404 });
  const ad = require('../adapter').of(rec).mail;
  const { ids, cursor } = await ad.changes(rec, rec.cursor);
  accounts.patch(personId, accountId, { cursor });
  const fresh = ids.filter(id => !triage.has(personId, accountId, id)).slice(0, MAX);
  const wishes = triage.rules(personId);
  const who = require('../../harness/turn/client').personById({ id: personId, orgId: require('../../auth/store').defaultOrg()?.id || null }) || { id: personId };
  const own = String(rec.account || '').toLowerCase();
  const out = { read: 0, 'needs-you': 0, handled: 0, filed: 0, drafts: 0, errors: [] };
  for (const id of fresh) {
    try {
      const m = await ad.meta(rec, id);
      let around = null;
      const ctx = async () => (around ??= await ad.around(rec, m).catch(() => []));
      let v = await require('./rules').classify(m, { own, wishes, wrote: async () => (await ctx()).some(x => x.sent || x.from?.address === own) });
      let by = 'rules', draftId = null;
      if (!v.verdict) {
        if (rec.reading?.reader === false) v = { ...v, verdict: 'needs-you', why: 'from a person (the mail reader is off for this account)' };
        else {
          try {
            const full = await ad.read(rec, id);
            const d = await require('./reader').decide({ mail: full, wishes, around: await ctx(), own, person: who }, _ask ? { ask: _ask } : {});
            v = { ...v, verdict: d.verdict, why: d.why };
            by = 'reader';
            if (d.draft && require('../scopes').can(rec).mailSend) {
              draftId = require('../drafts').make(personId, accountId, { reply: full, body: d.draft, why: 'the mail reader prepared it' }, { kind: 'reader', name: 'Mail reader' }).id;
              out.drafts++;
            }
          } catch (e) { v = { ...v, verdict: 'needs-you', why: `from a person; the mail reader could not read it (${e.message.slice(0, 120)})` }; }
        }
      }
      triage.put({ personId, accountId, mailId: m.id, threadId: m.threadId, from: m.from, subject: m.subject, snippet: String(m.snippet || '').slice(0, 200),
        date: m.date, type: v.type, verdict: v.verdict, why: v.why, by, ...(draftId ? { draftId } : {}) });
      out.read++; out[v.verdict]++;
    } catch (e) { out.errors.push(e.message.slice(0, 160)); }
  }
  if (out.read || out.errors.length) {
    require('../../activity').note({ from: 'accounts', person: who, why: trigger === 'schedule' ? 'its reading time came' : 'the person asked',
      what: `read ${out.read} new mail${out.read === 1 ? '' : 's'} for ${rec.account || rec.provider}: ${out['needs-you']} need${out['needs-you'] === 1 ? 's' : ''} you, `
        + `${out.handled} handled, ${out.filed} filed${out.drafts ? `, ${out.drafts} draft${out.drafts === 1 ? '' : 's'} waiting` : ''}${out.errors.length ? `, ${out.errors.length} could not be read` : ''}` });
  }
  return out;
}

module.exports = { read, _setAsk: fn => { _ask = fn; } };

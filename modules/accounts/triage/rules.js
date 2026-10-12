'use strict';

/**
 * Which mails need their person, decided mechanically first (the owner, 2026-10-12: "separated by type, mechanically
 * first … then a designated specialist decides the rest"). One pass over a mail's headers and sender, no model:
 *
 *   1. the person's own rule for this sender or domain (rules.js in the store: learned from their corrections)  → as set
 *   2. a calendar invitation (subject "Invitation:"/"Invito:"…; an answer to one — "Accepted:" — is only news)     → needs-you / handled
 *   3. a bill: words for invoice, amount due, payment, in the subject                                               → needs-you
 *   4. a newsletter or mailing list: List-Unsubscribe, List-Id, Precedence bulk/list                               → filed
 *   5. a receipt or an order/shipping confirmation                                                                 → filed
 *   6. a notification: Auto-Submitted, or a no-reply / notifications sender                                       → handled
 *   7. a reply in a thread the person wrote in                                                                     → needs-you
 *   8. anything else from a person                                                                                 → undecided: the mail reader decides
 *
 * `classify()` answers { type, verdict: 'needs-you'|'handled'|'filed'|null, why } — null only for 8.
 */
const INVITE = /^(invitation|updated invitation|invito|invitación|invitation mise à jour|einladung|new event|nuovo evento)\b[^:]*:/i;
const INVITE_ANSWER = /^(accepted|declined|tentatively accepted|accettato|rifiutato|aceptado|rechazado|accepté|refusé|zugesagt|abgesagt)\b[^:]*:/i;
const BILL = /\b(invoice|bill|amount due|payment due|payment reminder|overdue|fattura|bolletta|scadenza|pagamento|sollecito|factura|facture|rechnung|zahlung)\b/i;
const RECEIPT = /\b(receipt|your order|order confirm|order #|has shipped|shipping confirm|delivered|ricevuta|il tuo ordine|ordine n|spedito|consegnato|recibo|reçu|quittung|bestellung)\b/i;
const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounce|automated|news(letter)?)([+._-]|@)/i;

const domainOf = a => String(a || '').split('@')[1] || '';

/** `own`: the account's own address; `wrote`: whether the person wrote in this thread (asked only when it matters). */
async function classify(m, { own = '', wishes = {}, wrote = async () => false } = {}) {
  const from = m.from?.address || '', subject = m.subject || '', h = m.headers || {};
  const rule = wishes.senders?.[from] || wishes.senders?.[`@${domainOf(from)}`];
  if (rule) return { type: 'rule', verdict: rule, why: `your rule for ${wishes.senders?.[from] ? from : `@${domainOf(from)}`}` };
  if (own && from === own) return { type: 'own', verdict: 'handled', why: 'you sent it' };
  if (INVITE_ANSWER.test(subject)) return { type: 'invite', verdict: 'handled', why: 'an answer to an invitation' };
  if (INVITE.test(subject)) return { type: 'invite', verdict: 'needs-you', why: 'a calendar invitation waiting for your answer' };
  if (BILL.test(subject) && !RECEIPT.test(subject)) return { type: 'bill', verdict: 'needs-you', why: 'looks like a bill' };
  if (h.listUnsubscribe || h.listId || /^(bulk|list|junk)$/i.test(h.precedence || '')) return { type: 'newsletter', verdict: 'filed', why: 'a newsletter or mailing list' };
  if (RECEIPT.test(subject)) return { type: 'receipt', verdict: 'filed', why: 'a receipt or an order update' };
  if ((h.autoSubmitted && !/^no$/i.test(h.autoSubmitted)) || NOREPLY.test(from)) return { type: 'notification', verdict: 'handled', why: 'an automatic notification' };
  if ((h.inReplyTo || /^re:/i.test(subject)) && await wrote()) return { type: 'reply', verdict: 'needs-you', why: 'a reply in a conversation you wrote in' };
  return { type: 'person', verdict: null, why: 'from a person: the mail reader decides' };
}

module.exports = { classify, domainOf, INVITE, BILL, RECEIPT, NOREPLY };

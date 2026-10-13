'use strict';

/**
 * A question said aloud in a meeting, answered on the asker's own page (R6 round two; docs/design/meeting-notes.md §4):
 * a line is a question by rules alone — a question mark, or the words a question starts with in the five languages calls
 * know (no model) — and is answered from what the asker may open: the Library, by meaning (library/search.js, as that
 * person — only when its experiment is on), and the notes kept of their earlier meetings, by their words. The answer is
 * a card on the asker's pages alone (the live feed's `personIds`), with its sources — never said into the meeting.
 */
const STARTS = /^(what|when|where|who|why|how|which|did|do|does|is|are|can|could|should|will|would|cosa|che cosa|quando|dove|chi|perch[eé]|come|quale|quali|qu[eé]|cu[aá]ndo|d[oó]nde|qui[eé]n|por qu[eé]|c[oó]mo|cu[aá]l|quoi|quand|o[uù]|qui|pourquoi|comment|quel|quelle|was|wann|wo|wer|warum|wie|welche[rsn]?)\b/i;
const STOP = new Set('the and for with that this from what when where which who how are was were has have had not but you your our about into there their them they will would could should did does can cosa che come dove quando chi per con una uno del della dei delle quale quali'.split(' '));

/** Whether a transcribed line asks something. */
function isQuestion(text) {
  const t = String(text || '').trim();
  return t.length > 8 && (/\?\s*$/.test(t) || STARTS.test(t));
}

const words = t => [...new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3 && !STOP.has(w)))];

/** Lines of the asker's earlier meetings' notes holding at least two of the question's words (or the one, if one). */
async function fromMeetings(person, question, notCurrent) {
  const want = words(question);
  if (!want.length) return [];
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const list = await require('./store').forPerson(person.id, { since }).catch(() => []);
  const out = [];
  for (const m of list) {
    if (m.id === notCurrent) continue;
    const md = require('./notes').readRecord(m.id);
    if (!md) continue;
    for (const line of md.split('\n').filter(l => l.startsWith('- '))) {
      const hit = want.filter(w => line.toLowerCase().includes(w)).length;
      if (hit >= Math.min(2, want.length)) out.push({ kind: 'meeting', meeting: m.id, title: m.title || 'A meeting', text: line.slice(2, 300), hit });
    }
  }
  return out.sort((a, b) => b.hit - a.hit).slice(0, 3).map(({ hit, ...x }) => x);
}

/** From the Library, as the asker (its experiment on, a model set): the best three files. */
async function fromLibrary(person, question) {
  try {
    if (!require('../experiments').on('library')) return [];
    const r = await require('../library/search').search(person, question, { limit: 3 });
    return (r.results || []).map(x => ({ kind: 'file', name: x.name, path: x.path, text: x.match?.text?.slice(0, 200) || x.about || '' }));
  } catch { return []; }
}

/** Answer a question line for its asker: a card on their pages, or nothing when nothing was found. */
async function answer(roomId, person, line) {
  if (!isQuestion(line.text)) return null;
  const [files, meetings] = await Promise.all([fromLibrary(person, line.text), fromMeetings(person, line.text, roomId)]);
  if (!files.length && !meetings.length) return null;
  const card = { question: line.text, at: line.at, sources: [...files, ...meetings] };
  require('../live').changed('meeting', roomId, 'notes-answer', { personIds: [person.id], card });
  return card;
}

module.exports = { isQuestion, answer, words, fromMeetings };

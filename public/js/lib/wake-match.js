/* Whether a transcript begins by calling the hive (wake-word.js; docs/experiments/wake-word.md). Speech-to-text has
   never heard an invented name, so it may write what it sounds like — "Doka", "Dokka", "Dota" — and the match is by
   sound-alike spelling, near the start of what was said, not anywhere in it: "the dock is closed" is not a call. */

const WAKE_MAX_POSITION = 2;   // "hey doca", "ok doca, …": the name within the first three words

function _wakeNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').trim();
}

/** Spelling folded the way the ear folds it: c/k/q/ck alike, double letters single, a final -ah/-uh as -a. Not -er:
    measured, "Docker" is a word people say and Whisper writes the name itself (docs/experiments/wake-word.md). */
function _wakeFold(w) {
  return w.replace(/ck|q|c/g, 'k').replace(/ph/g, 'f').replace(/(.)\1+/g, '$1').replace(/(ah|uh)$/, 'a');
}

function _wakeDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** {heard, rest}: whether `text` calls `word` near its start, and what was said after it (the call's first message). */
function wakeMatch(text, word) {
  const want = _wakeNorm(word).split(' ').filter(Boolean).map(_wakeFold);
  const raw = String(text || '').trim().split(/\s+/), said = raw.map(t => _wakeFold(_wakeNorm(t).replace(/ /g, '')));
  if (!want.length) return { heard: false, rest: '' };
  const target = want.join(''), allow = target.length <= 3 ? 0 : target.length <= 6 ? 1 : 2;
  for (let i = 0; i <= Math.min(WAKE_MAX_POSITION, said.length - 1); i++) {
    for (let n = 1; n <= Math.min(want.length + 1, said.length - i); n++) {   // a name heard as two words: "do ka"
      const got = said.slice(i, i + n).join('');
      const dist = got ? _wakeDistance(got, target) : 99;
      // A short name may be misheard by a letter, never by one more or one fewer: "dock" is not "doca".
      if (dist === 0 || (dist <= allow && (target.length > 5 || got.length === target.length))) {
        const rest = raw.slice(i + n).join(' ').replace(/^[\s,.!?;:—-]+/, '').trim();
        return { heard: true, rest: /[a-z0-9]/i.test(rest) ? rest : '' };
      }
    }
  }
  return { heard: false, rest: '' };
}

'use strict';

/**
 * Which language a short text is in, by its script and its most common words — no model, no dependency, cheap enough
 * for every transcript of a call (2026-10-08: a two-word question in a call came back from the transcriber as Russian,
 * "Что это?", and was answered in Russian to a person who speaks English and Italian). A guess, never a fact: it
 * answers null when the text does not say, and the callers treat null as "unknown", not as English.
 */

// A script that is one language in practice, or near enough for "is this the person's usual language".
const SCRIPTS = [
  [/[Ѐ-ӿ]/gu, t => (/[іїєґ]/iu.test(t) ? 'uk' : 'ru')],
  [/[Ͱ-Ͽ]/gu, () => 'el'],
  [/[֐-׿]/gu, () => 'he'],
  [/[؀-ۿ]/gu, () => 'ar'],
  [/[ऀ-ॿ]/gu, () => 'hi'],
  [/[぀-ヿ]/gu, () => 'ja'],
  [/[가-힯]/gu, () => 'ko'],
  [/[一-鿿]/gu, () => 'zh'],
];

// The words that carry a Latin-script language: short, frequent, and rarely shared.
const WORDS = {
  en: 'the and you what is are it this that to of in my me can how do does with for please weather today i was what\'s it\'s yes no',
  it: 'il lo la gli le che di del della e è sono non per con un una cosa come mi ti ci questo quello perché grazie sì anche oggi tempo fa dove',
  es: 'el la los las que de del y es son no por con un una qué cómo me te esto eso porque gracias sí también hoy dónde está',
  fr: 'le la les que de du des et est sont ne pas pour avec un une quoi comment je tu ce cette parce merci oui aussi aujourd\'hui où',
  de: 'der die das und ist sind nicht für mit ein eine was wie ich du dies das weil danke ja auch heute wo wetter',
  pt: 'o a os as que de do da e é são não por com um uma como eu tu isto isso porque obrigado sim também hoje onde está',
  nl: 'de het een en is zijn niet voor met wat hoe ik jij dit dat omdat dank ja ook vandaag waar',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

/** The language of `text` as an ISO 639-1 code, or null when it does not say. */
function guess(text) {
  const t = String(text || '');
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (!letters) return null;
  for (const [re, lang] of SCRIPTS) {
    const n = (t.match(re) || []).length;
    if (n / letters > 0.5) return lang(t);
  }
  const words = t.toLowerCase().normalize('NFC').match(/[\p{L}']+/gu) || [];
  const score = Object.fromEntries(Object.keys(SETS).map(k => [k, words.filter(w => SETS[k].has(w)).length]));
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  // One shared word ("no", "e") says little: a guess needs a word, and a lead over the next language.
  if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

/** Names, for a prompt and a log line. */
const NAMES = { en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian',
  uk: 'Ukrainian', el: 'Greek', he: 'Hebrew', ar: 'Arabic', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pl: 'Polish', tr: 'Turkish' };
const nameOf = code => NAMES[code] || code || '';

/** A transcriber's own word for a language ("english", "en", "English") as a code, or null. */
function codeOf(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  if (/^[a-z]{2}$/.test(w)) return w;
  const hit = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === w);
  return hit ? hit[0] : null;
}

module.exports = { guess, nameOf, codeOf, NAMES };

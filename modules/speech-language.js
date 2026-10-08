'use strict';

/**
 * Which language a sentence is in, for a voice that must be told (Qwen3-TTS: left to guess, an Italian sentence
 * spoken by one of its voices came back heard as Spanish; named, word for word — measured 2026-10-08). A sentence is
 * short and a model would cost a request per sentence, so: the script first (kana, hangul, han, cyrillic), then the
 * commonest small words of the Latin-script languages. Unsure is null, and the voice keeps its own guess ("Auto").
 */

// The words a sentence in each language is all but certain to contain, and that the others rarely use.
const WORDS = {
  English:    'the and you your is are to of it that this for with was have i not be do we what on at my me can will',
  Italian:    'il lo la gli le che di è non per una un sono ho hai anche con del della nel cosa come mi ti ci si sì già più ma perché questo',
  Spanish:    'el los las que de es no por una un soy con del en lo se sí ya más pero porque esto qué cómo está muy también',
  French:     'le les la des que de est pas pour une un je suis avec du dans ce se oui déjà plus mais parce cette vous nous très aussi',
  German:     'der die das und ist nicht ich du sie wir mit ein eine zu auch schon noch aber weil dass sehr ja nein was wie',
  Portuguese: 'o os as que de é não por uma um sou com do da em se sim já mais mas porque isso você muito também está',
};
const LISTS = Object.fromEntries(Object.entries(WORDS).map(([lang, w]) => [lang, new Set(w.split(' '))]));

/**
 * The language of `text` among `languages` (the voice's own names, e.g. "Italian"), or null when it cannot be told.
 */
function guess(text, languages = Object.keys(WORDS)) {
  const t = String(text || '');
  const has = re => re.test(t);
  if (has(/[぀-ヿ]/)) return pick('Japanese', languages);
  if (has(/[가-힯]/)) return pick('Korean', languages);
  if (has(/[一-鿿]/)) return pick('Chinese', languages);
  if (has(/[Ѐ-ӿ]/)) return pick('Russian', languages);
  const words = t.toLowerCase().replace(/[’']/g, ' ').match(/[\p{L}]+/gu) || [];
  if (!words.length) return null;
  let best = null, top = 0, second = 0;
  for (const lang of languages) {
    const list = LISTS[lang];
    if (!list) continue;
    const n = words.filter(w => list.has(w)).length;
    if (n > top) { second = top; top = n; best = lang; } else if (n > second) second = n;
  }
  return top > 0 && top > second ? best : null;
}

const pick = (lang, languages) => (languages.includes(lang) ? lang : null);

module.exports = { guess, WORDS };

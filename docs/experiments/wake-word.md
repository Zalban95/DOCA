# Experiment: start a call by saying the hive's name

**Flag:** `experiments.wakeWord` (Settings → Developer, or Settings → Voice → Live call), off by default. **TODO:** H8.2.
**Since:** 2.210.0. **Per screen:** `call.listenWithFace` and `call.wakeWord` (Settings → Voice → Live call).

## Hypothesis

A screen that shows the face — a phone on a stand, a tablet on a wall — is somewhere a person talks *to*. Tapping it
to start a call defeats the point. Wake-word engines (Porcupine, openWakeWord, Snowboy) need a model trained per word,
and the word here is an invented one that a person can change in Settings and that a private label renames. The hive
already runs a speech-to-text service, and Whisper takes a *prompt* that steers its spelling. Short bursts of speech,
transcribed with the wake word as the hint and matched by sound-alike spelling near the start, should catch the name
well enough to be useful with no model to train, for any word, in any language Whisper knows.

## What happens when it is on

On a screen where the corner face is shown and "Call by name" is ticked, while no call is on and the page is visible:

1. The page listens to the microphone with the call's own threshold. A burst of sound with at least 300 ms over it, ended
   by 0.7 s of quiet (or cut at 5 s), is recorded.
2. It goes to `POST /api/chat/transcribe` with `prompt` = the wake word. The hub's screen drops silence phrases
   (`modules/stt-filter.js`).
3. `public/js/lib/wake-match.js` decides: the name within the first three words, spelled as the ear hears it (c/k/ck/q
   alike, double letters single, a final -ah/-uh as -a — "Doka", "Dokka", "do ka"), one letter of difference allowed for a
   name of four to six letters (never a letter more or fewer: "dock" is not "doca").
4. A match starts the live call; what was said after the name is its first message. The call ends as before, and the
   page listens again.

The default word is the product's name (`branding.product`), so a renamed edition answers to its own name.

## Measured

`npm run experiment -- wake-word`: phrases that call and phrases that do not, spoken by this machine's TTS in three
voices and heard by its STT with and without the hint.

| Date | STT model | Word | Calls caught | Non-calls that started one | Median time to hear |
|---|---|---|---|---|---|
| 2026-10-05 | faster-whisper large-v3-turbo (ct2) | "DOCA", with the hint | 15 of 15 | 3 of 21 (all "Docker …") | 492 ms |
| 2026-10-05 | same | "DOCA", without the hint | 15 of 15 | 3 of 21 (all "Docker …") | 483 ms |
| 2026-10-05 | same, after dropping the -er fold | "DOCA", with the hint | 15 of 15 | 0 of 21 | 491 ms |
| 2026-10-05 | same, after dropping the -er fold | "DOCA", without the hint | 15 of 15 | 0 of 21 | 485 ms |

The first run folded a final *-er* into *-a* on the guess that Whisper would hear the name as "Docker"; it heard
"DOCA" every time and "Docker" only when Docker was said, so the fold was a false start generator and went. For this
word the spelling hint changed nothing either way (once, in an earlier run, it turned a spoken "Docker" into "DOCA");
it stays, because it is free and an invented word less like English may need it — the measure to rerun for any new word.

Synthesized speech is cleaner than a room, so this is the floor of the error; a person's own calls are the rest of the
measure (false starts per hour of a television in the room is the number that decides whether this graduates).

## Cost

Each burst of speech near the screen is one transcription by the local STT — about 0.3–0.8 s of GPU for a short phrase
with large-v3-turbo. A quiet room costs nothing (nothing over the threshold is sent). One open microphone on the screen.

## Risks

- **Privacy**: while it listens, everything said near the screen is sent to the hive's speech-to-text. It is the owner's
  own service, nothing is kept, and the setting says so — but it is a microphone that is always on while the face shows.
  Browsers show their recording indicator throughout.
- **False starts**: a name that sounds like a common word starts calls by itself. Choose a distinctive word.
- **A page nobody touched**: browsers start audio suspended until the first touch on the page; until then it does not
  hear. DocaMobile's web view lets it start at once.
- **Battery** on a phone: the microphone and an analyser run while the face shows.

## Rollback

Switch the flag off (every screen stops listening at its next load or settings change), or untick "Call by name" on one
screen.

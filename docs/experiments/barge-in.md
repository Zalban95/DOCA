# Experiment: talk over the agent in a voice call

**Flag:** `experiments.bargeIn` (Settings → Developer), off by default. **TODO:** H8.3. **Since:** 2.192.0.

## Hypothesis

A call feels like a conversation when you can interrupt. Today the call already stops the agent's voice when you
start speaking, but it does not *listen* while a turn is working — what you say then is lost — and sentences of the
interrupted answer can still arrive and be spoken after you have moved on. If speech is always recorded and sent, the
running turn reads it before its next step (the hub's inbox: one conversation, nothing interleaved) and the work
carries on with your correction instead of being restarted; dropping what was about to be said keeps the call from
answering a question you no longer asked.

## What happens when it is on

1. The microphone is listened to during the whole call, also while a turn works.
2. Speech during the agent's voice stops it (as before) and marks everything it was about to say as stale: sentences
   already sent to the speech service are dropped when they come back.
3. What you said is transcribed and sent at once. A working conversation keeps it in its inbox; the running turn reads
   it before its next step and its answer is spoken. Nothing is cancelled: the work continues.
4. At the end of the call one line says how long it lasted, how often you interrupted and how many stale sentences
   were not spoken.

## Measured

By hand, for now: calls of a few minutes on a laptop's speaker and microphone and on a headset, counting **false
interruptions** (the agent's own voice or room noise read as speech: the call line counts every interruption, the
person counts the ones they did not make) and the **time from speaking to silence** (the voice stops within one
animation frame of the energy crossing the threshold).

| Date | Device and audio | Minutes | Interruptions (false) | Stale sentences dropped | Notes |
|---|---|---|---|---|---|
| — | — | — | not measured yet: needs a person in a call | — | — |

## Cost

No new requests: the same transcription and speech calls, one more transcription per interruption, and one more turn
message read from the inbox. The microphone stays open while the agent works (it already stayed open while it spoke).

## Risks

- **Echo**: on a speaker without echo cancellation the agent's own voice can interrupt it. The call now asks the
  browser for echo cancellation and noise suppression; a room that still triggers it is what the false-interruption
  column measures.
- **Half sentences**: a cough mid-answer stops the voice; the text stays on screen.
- **More turns in flight**: an interruption while a turn runs is read by that turn, not started as a second one —
  the inbox makes that safe.

## Rollback

Switch the flag off: the call waits for the agent's turn before listening again, as before.

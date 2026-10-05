# Experiment: the face follows a voice call

**Flag:** `experiments.faceVoice` (Settings → Experiments), off by default. **TODO:** H8.2. **Since:** 2.193.0.

## Hypothesis

In a call the face in the panel's corner shows only what the hive reports (thinking, working, speaking as text
arrives) — it does not move when the voice does. A mouth that opens with the agent's actual voice, and a face that
turns to listen when you speak, makes a call read as talking *to* something rather than at a speaker, at almost no
cost: the call already measures both levels.

## What happens when it is on

During a voice call, once a frame: while the agent's voice plays, the corner face is set to *speaking* with the voice's
level (an analyser between the playback and the speakers); while you speak, to *listening* with the microphone's level.
For a moment after either stops, the hive's own state feed waits, then takes the face back. Only a screen with the
corner face switched on (Settings → General → Appearance) shows it.

## Measured

| Date | Browser and machine | Extra time per frame | Lag voice → mouth | Notes |
|---|---|---|---|---|
| — | — | not measured yet: needs a person in a call | — | — |

Measure in the browser's Performance panel during a call with the flag on and off: the difference in scripting time per
frame is the cost (two `getByteFrequencyData` calls of 128–256 bins and a canvas update the face draws anyway); the lag
is judged by eye against the voice.

## Cost

One AnalyserNode in the playback path, read once a frame while a call is open; nothing outside a call.

## Risks

- **A face that disagrees with the hive**: while the call drives it, an approval question raised elsewhere waits up to
  1.5 s to show as *asking* on the face (the card and popup are immediate).
- **Audio routing**: the voice now passes through an analyser before the speakers; a browser that mishandles that
  would play nothing — off is the old path exactly.

## Rollback

Switch the flag off: the playback goes straight to the speakers and the face follows only the hive.

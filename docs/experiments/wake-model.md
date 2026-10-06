# Experiment: a small model trained for the hive's name

**Flag:** `experiments.wakeModel` (planned), off by default. **TODO:** H8.4. **Builds on:** `wakeWord` (wake-word.md).

## Hypothesis

`wakeWord` sends every burst of sound near a listening screen to the hive's speech-to-text and looks for the name in
the transcript. It works (15 of 15 calls, 0 of 21 non-calls, measured with a desk microphone) but it costs a
transcription per burst, takes half a second to a second, sends room audio to the hub, and depends on how Whisper
spells one person's accent ("Doca" came back as "Madoka" inside calls). Asked 2026-10-06: "aren't there micro models
that recognize a word you train them for? … why with hey Google the microphone icon is not always shown".

A keyword-spotting model trained for the one word — openWakeWord (open, Apache 2.0, ~1 MB ONNX, trained from synthetic
speech) — run on the screen itself should hear the name sooner (≈0.1–0.2 s), send nothing until it does, work while
the hub's speech service is down, and miss less for the person it was checked against.

## What happens

1. **Training on the hub.** When a wake word is set, the hub trains a model for it: openWakeWord's pipeline, positives
   spoken by thousands of synthetic voices (Piper's LibriTTS-R model, many speakers and speeds), negatives from its
   precomputed features of 2,000 hours of other audio, augmented with room echoes and noise. A GPU takes about an hour.
   The model is kept like the apps' APKs (`DATA_DIR/wakeword/<word>.onnx`) and its measured scores beside it.
2. **The person's own voice** checks it. Voice messages recorded in the chat (attachments `voice-*.webm|wav`) are split
   by hand into "the word" and "not the word"; some may join training, the rest are the test set.
3. **The panel** runs the model in the page (ONNX Runtime Web, WebAssembly) on the microphone it already opens for the
   wake word; a detection starts the call exactly as a transcript match does today. Nothing is sent until then.
4. **DocaMobile** downloads the same model and runs it with ONNX Runtime for Android; the screen saver and the app use
   it. A later step — DocaMobile as the phone's default assistant (VoiceInteractionService + HotwordDetectionService) —
   is the only way an app listens without the microphone indicator, as Google's assistant does.

## Measured

| Measure | Today (`wakeWord`) | Model | Target |
|---|---|---|---|
| Calls heard, synthetic and recorded | 15/15 (desk mic) | — | ≥ 95 % |
| The person's own recordings heard | — | — | ≥ 90 % |
| False starts on near words and room sound | 0/21 | — | ≤ 1 per 10 h of room audio |
| Time from the end of the word to the call | 0.5–1 s | — | ≤ 0.3 s |
| Audio sent to the hub while waiting | every burst | — | none |

## Cost

One training run per word (about an hour of GPU, ~20 GB of shared training data downloaded once); ~1 MB per model; a
WebAssembly runtime (~10 MB, from a CDN, cached) on screens that use it.

## Risks

- A model for a short invented word may fire on near words ("doctor", "dock"); the false-start test is the gate.
- Synthetic voices are English; an Italian speaker's "Doca" is the case to check, which is why the person's recordings
  are the test set.
- The training pipeline is another heavy toolchain on the hub: it runs in its own environment (later a container), and
  only on a person's request.

## Rollback

The flag off: screens use `wakeWord`'s transcript match as before. Removing the experiment removes the model files.

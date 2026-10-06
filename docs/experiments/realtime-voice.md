# Experiment: live calls with a realtime speech model

**Flag:** `experiments.realtimeVoice` (Settings → Developer, or Settings → Voice → Live call), off by default.
**Settings:** `realtime.*` (Settings → Voice → Live call → Realtime speech model). **TODO:** H8.3. **Since:** 2.200.0.

## Hypothesis

The 🎙 Live call today is speech-to-text, a turn, then text-to-speech: three hops and two waits on silence before
anything is heard, and interrupting is something the panel approximates (`bargeIn`). A speech-to-speech model hears
and speaks directly, detects the end of speech and interruptions itself, and answers in well under a second. If it is
put **in front of** the hive rather than in place of it — a voice whose only tool hands real work to the person's
conversation — the call becomes quick to talk to without the voice gaining any power of its own.

## The market, and what was picked (2026-10)

| | Protocol | Where it runs | Price per minute (approx.) | Notes |
|---|---|---|---|---|
| OpenAI Realtime (`gpt-realtime`) | OpenAI Realtime, WebSocket/WebRTC | hosted | ~$0.30 | the reference; one model per API |
| Azure OpenAI Realtime | the same protocol, `api-key` header | hosted, regional | similar | same protocol, different address |
| Hugging Face speech-to-speech | the same protocol at `ws://…:8765/v1/realtime` | **local** (any OpenAI-compatible LLM behind it, Parakeet STT, Qwen3-TTS) | your hardware | "a tested core subset" of the protocol |
| Gemini Live | BidiGenerateContent, WebSocket | hosted | ~$0.02 | 16 kHz in / 24 kHz out, native transcripts, asynchronous tools |
| Moshi, Ultravox, SeamlessM4T | their own | local / hosted | — | no common protocol; translation-first (Seamless) |

Two protocols cover nearly everything: **OpenAI's Realtime surface** (spoken by OpenAI, Azure and the local
open-source servers) and **Gemini Live** (far cheaper). Both are adapters behind one interface
(`modules/realtime/openai.js`, `gemini.js`), chosen by `realtime.protocol`; a third protocol is a third file. The key
and address come from a provider in Field → API keys (`realtime.provider`), or `realtime.url` for Azure or a local
server; `realtime.dialect: beta` sends the earlier session shape some compatible servers still expect.

## What happens when it is on

1. With the flag on and `realtime.model` set, the 🎙 Live button opens a realtime call instead of the
   speech-to-text path (which stays, unchanged, for every other case).
2. The browser streams the microphone (PCM16, 24 kHz) to the hub over `/ws/realtime`; the hub relays it to the
   service and plays its voice back. **The key never leaves the hub**, and a paired device can call the same way at
   `/api/v1/realtime` with its token (PROTOCOL.md) — a phone app needs no provider account of its own.
3. The voice model holds one tool, `doca`. A request for anything real becomes an ordinary turn in the person's
   conversation — their level, approvals, the charter, the queue for a working conversation — and its answer is said.
4. Work that takes longer than `realtime.waitSec` (20 s) carries on: the voice says it is under way, and when the
   turn finishes its answer is handed to the voice to say ("work continuing in the background").
5. Interrupting is the service's own voice-activity detection: talking over an answer stops it, and the panel drops
   what was queued to play.
6. The call ends with a line: minutes, requests to the hive (and how many carried on), interruptions, time to the
   first answer.

## Measured

`npm run experiment -- realtime-voice` gives the configured service five typed utterances (small talk and questions
only the hive can answer) and reports **routing** (the `doca` tool for the hive's questions and only for those) and
the **median time to first audio**; typed words skip the service's speech recognition. By hand, in real calls: false
interruptions (room noise or the agent's own voice) and how a long request reads when it comes back later.

| Date | Service / model | Routed right | Median to first audio | Failed |
|---|---|---|---|---|
| — | not measured yet: needs the owner's realtime key or a local speech-to-speech server | | | |

## Cost

Hosted services bill per minute of audio, both ways, whether or not anything is said — about $0.30/min for OpenAI's,
about $0.02/min for Gemini Live (2026 prices; check the provider). A local server costs only the machine. The hive's
own turns cost what they always did.

## Risks

- **A voice that claims to have done something.** The instructions forbid it and the voice has no tool but `doca`,
  so it cannot act; it can still misspeak. The conversation holds what was actually asked and answered.
- **Small talk is not written down.** Only what reaches the `doca` tool becomes a turn; a person who said something
  important to the voice alone has said it to nobody who remembers.
- **Audio leaves the machine** for a hosted service, continuously for the length of the call. A local server avoids it.
- **Compatible is not identical**: local servers implement a subset of the OpenAI protocol (the HF one says so).
  `dialect` covers the session shape; anything else shows as an error line in the call.

## Rollback

Switch the flag off: the 🎙 Live button goes back to speech-to-text → turn → text-to-speech on the next call. Nothing
is stored by a realtime call except the turns it started.

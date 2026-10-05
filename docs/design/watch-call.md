# A live call on the watch, and the watch's updates

Status: the hub's side is built (2.211.0); DocaMobile and DocaWear carry the rest. Asked 2026-10-05: "a call
protocol, so the call can be carried via Bluetooth to the DocaWear, and an updater for the Wear OS app as well."

## What is already true

- A watch has no network of its own that reaches a tailnet hub. Everything it says to the hub travels over the Wear OS
  Data Layer to the phone, which performs it with **the watch's own token** (DocaMobile `docs/WEAR_BRIDGE.md`, "The phone
  is the watch's network, and not its identity"). A Data Layer *message* holds about 100 KB and is one request, one
  answer: right for JSON, wrong for a stream of audio or a 30 MB APK.
- The Data Layer also has **channels** (`ChannelClient`): a byte stream between the two apps, opened by either side,
  carried over Bluetooth (or Wi-Fi when the watch has it), no size limit. Both apps already share one `applicationId`
  and one key, which is what lets them talk at all.
- The hub holds the newest DocaWear APK (`modules/client-apps`, `GET /api/v1/clients/android/docawear`) and can build
  it from its repository.

## The call

### One endpoint, whichever engine (hub, built)

`/api/v1/call` (PROTOCOL.md §23.1.1): a WebSocket with the wire of `/api/v1/realtime` — PCM16 mono 24 kHz both ways,
JSON frames `ready`, `user`, `agent`, `working`, `interrupted`, `done`, `error`, `closed`, and `{type: "stop"}` from the
client. The hub picks the engine: the realtime model while one is on, else **the hive's own voice**
(`modules/realtime/pipeline.js`): it finds speech against the room's floor, sends an utterance with at least 300 ms of
speech to speech-to-text when 0.9 s of quiet ends it, hands the words to the conversation as a turn of the device, and
speaks the answer a sentence at a time with the TTS's raw PCM. Speech over the answer stops it. A client is written
once; the engine is the owner's choice and can change under it.

Measured on this hub (large-v3-turbo, Kokoro on CPU): the words reach the conversation 1.2 s after the speaker stops
(0.9 s of it is the pause that ends an utterance), and a short sentence is synthesized in about 0.5 s.

### Watch ↔ phone: a framed channel (DocaMobile + DocaWear)

Channel path **`/doca/call`**, opened by the watch. Both directions carry **frames**:

| Bytes | Field |
|---|---|
| 1 | type: `1` audio, `2` JSON |
| 3 | length of the payload, big-endian (≤ 16 MB; in practice < 2 KB) |
| n | payload |

- **Audio is Opus**, one packet per frame, 20 ms each, mono — the watch encodes its microphone at 16 kHz (about
  24 kbit/s), the phone encodes the hub's speech at 24 kHz. Raw PCM would be 256–384 kbit/s each way, which a Bluetooth
  LE link shared with everything else on the wrist does not sustain; Opus at 24 kbit/s does, and Android has encoded and
  decoded it with `MediaCodec` since API 29 (the watch's minimum is 30). **The phone transcodes**: Opus ⇄ PCM16
  24 kHz, so the hub never sees Opus and needs no codec.
- **JSON frames** are the hub's own JSON frames, passed through unchanged, plus two of the bridge's own:
  - watch → phone first: `{"type": "open", "authorization": "Bearer …", "session": "<id>"?}` — the watch's token, which
    the phone puts on the WebSocket and does not keep (the identity rule of the request relay);
  - phone → watch on failure before the hub answered: `{"type": "error", "where": "phone", "message": …}` — "the call
    never reached the hub", as the relay's `error` means.
- **Either side closing the channel ends the call**; the phone then sends `{type: "stop"}` and closes the socket. A
  dropped Bluetooth link is a hang-up, not a pause.
- **Barge-in**: on `interrupted` the watch drops the audio it has queued, as every client of §23.1 does.

The watch records with `VOICE_COMMUNICATION` (Android's echo cancellation, so its own speaker is not heard as the
person) and plays through `AudioTrack` with `USAGE_VOICE_COMMUNICATION`, which picks the wrist speaker or a paired
headset. The microphone permission is asked on the first call, with the reason on screen (DocaWear §6.4).

### Why not alternatives

- **The watch calling the hub directly** — only a LAN hub is reachable; a tailnet hub, the normal case, is not.
- **Bluetooth audio (HFP/SCO) from phone to watch** — Wear OS does not route a phone's call audio to the watch's own
  speaker and microphone for a third-party app; the Data Layer channel is the supported path.
- **Speech recognition on the watch** (`RecognizerIntent`) and sending text — works for one question, but a call is a
  conversation with barge-in and the hive's own voice; the watch would also need the hub's TTS back as audio anyway.
  It stays the watch's quick-question path.

## The watch's updates (DocaMobile + DocaWear)

1. **Learning there is one.** The watch asks `GET /api/v1/clients/android/docawear` through the request relay, as any
   call (its token; "any token" may read it), compares `versionCode` with its own, at start and twice a day. The phone's
   Settings → Updates also shows the watch's line ("DocaWear 1.1.0 on the watch, 1.1.1 on the hub — Send to watch"),
   from the watch's version in `/doca/state`.
2. **Carrying it.** Channel path **`/doca/update/apk`**, opened by the phone when the watch asks
   (`/doca/update/fetch` message: `{versionCode, sha256}`) or when the person taps Send. The phone downloads the APK
   from the hub (`/api/v1/clients/android/docawear/apk`), checks its sha256 against the announcement, and sends it with
   `ChannelClient.sendFile`; the watch receives it with `receiveFile` into its cache.
3. **Installing it.** The watch checks the sha256 again and commits a `PackageInstaller` session — DocaMobile's
   `AppUpdater`, the same code shape. Wear OS shows its own confirmation unless the app is already its own installer of
   record (`USER_ACTION_NOT_REQUIRED`, Wear OS 4+), as on the phone. `REQUEST_INSTALL_PACKAGES` in the watch's manifest.
4. **Signing**: one key for both (the hub's `keys/android-signing.keystore`), already required for the Data Layer.

A watch paired directly to a LAN hub downloads the APK itself, the same fallback the request relay has.

## Order of work

1. Hub: `/api/v1/call` and the pipeline engine — **done in 2.211.0**.
2. DocaWear: the framed channel client, Opus in and out, a call screen (a big button; the face's states as colour);
   the updater (check, receive, install).
3. DocaMobile: the `/doca/call` channel ⇄ WebSocket bridge with the Opus transcoding; the `/doca/update/apk` sender and
   the watch's line in Settings → Updates.
4. On a real phone and watch: a call over Bluetooth (latency, dropouts, battery per minute), and an update end to end.
   Neither can be checked without the person's watch; both are written to be testable in unit tests up to the radio.

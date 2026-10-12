# Cast reach: how a TV, a speaker or a headset gets what it is sent

Asked 2026-10-12 (the owner), on "how should a Cast TV or speaker reach the page it is sent?":

> Every way, depending on where the device we are casting to is connected. If we are in the same wifi but is a
> different one than the host the served page sits in docamobile... If it's a bit device then directly from the phone
> or from the host. In the nearby devices we should be able to chose if we are searching from the phone, from the host
> or from another client. All of this has to be on the panels and specifically orchestrators reach. And if the device
> is not in the same wifi of this client but another one then that client shows what the user on another client wants
> to serve, wherever the original source comes from.

And for speakers:

> DOCA's voice, Music / media links, The page's sound, Calls for example or an assistant mode similar of the ambient
> one. Or if the chat is prompted. From a device to say something on a specific device or to play something it has to
> just go through. Same for headsets and similar. A headset can be a work station in a sense, a call can be a work
> session with the orchestrator or the chat meetings.

This document continues `cast-and-devices.md` (phase 1 is built: `modules/cast` casts a page to a signed-in screen and
makes view links; the owner's answers there stand). It says how a page, a sound or a call reaches a thing that is not
a DOCA screen, from whichever machine can see it. Built on `modules/nearby`, `modules/cast`, `modules/screens`,
`modules/realtime`, `harness/reach.js`, the device families (PROTOCOL §22.1) and the device's own socket (§22.2).

Facts are marked **[verified]** (read in source or measured), **[practice]** (what a working open-source sender relies
on, not yet tried on our devices) or **[assumed]** (to check on the owner's TV and speaker before a phase is called
done). Questions only the owner can answer are marked **Owner:** and gathered at the end.

## 0. The shape in one paragraph

**The hub is where every source meets; the last hop belongs to whoever stands on the target's network.** Whatever is
cast — a panel page, a computer's served page, a file on a desk, DOCA's voice — is already reachable by the hub over
the tailnet (previews, `/api/devices/:id/files`, attachments, TTS). A TV or a speaker cannot reach the tailnet and will
not accept the hub's certificate, so one machine on the TV's network carries the bytes across the last metre: the hub
itself when it sits on that network, else a client that does (DocaMobile, DocaDesk, doca-client). That machine is the
**relay**. It adds no credentials of its own — the watch relay's rule (DocaMobile AGENTS.md, "The relay client carries
no token") — so what the TV may see is decided by the hub, once, by the view link or media token it was given.

## 1. Topology: who can reach the target

### 1.1 Three cases

| Case | Example | Who sends the Cast/DLNA commands | Who serves the bytes |
|---|---|---|---|
| **Hub on the target's LAN** | the owner's Google Home Max and Philips TV, on the hub's Wi-Fi today | the hub | the hub's cast door (§2.2) |
| **A client on the target's LAN, the hub elsewhere** | a hub on a VPS or at the office, the phone at home; a desk at home while the person is out | that client | that client (§2.3), fetching from the hub over its own tailnet/hub connection |
| **Nobody** | a TV on a Wi-Fi no paired device is on now | — | the cast is refused with where the thing was last seen and from which device ("Living-room TV was seen from Al's phone on Home Wi-Fi, 3 h ago — open DocaMobile there") |

A target on the *same* Wi-Fi as the person's phone but a *different* one from the hub is case two, and is the common
mobile case the owner names first.

The source and the caster are independent of the relay: a person on their phone at work may cast the Workstream to
the home TV through DocaDesk at home ("that client shows what the user on another client wants to serve"); a person at
the hub's own panel may cast through their phone. Only the relay has to stand next to the target.

### 1.2 Where a thing was seen from

Today a sighting has a `source` (cast, mdns, ssdp…) but not *who* looked: every scan is the hub's. It gains:

```
seenFrom: [{ by: 'hub' | '<device id>', network: '<net id>', address: '192.168.1.34', at: ISO }]
```

kept per thing in `nearby/seen` (merge.into keeps the newest entry per `by`), and copied to a saved thing like
`addresses`. `describe.line` says it: "seen 2 min ago from the hub, 3 h ago from Al's phone".

### 1.3 A network, named once

A **network** is what a person calls "Home Wi-Fi": `nearby/networks` (store.js, never prefs):

```
{ id: 'net_<12 hex>', label: 'Home Wi-Fi', ssid: 'Fritz!Box 7590 XY' | null, subnet: '192.168.178.0/24',
  gateway: '192.168.178.1', gatewayMacHash: '<12 hex>' | null, firstSeen, lastSeen, seenBy: ['hub', 'dev_…'] }
```

Each looker reports what its system lets it read: the hub its interfaces' subnets, the default gateway and the
gateway's MAC from the ARP table (`nearby/lan.js` already marks `gateway: true`); Android the SSID (needs the location
permission DocaMobile already holds and location on — **[assumed]** on Android 13+, `NEARBY_WIFI_DEVICES` may be needed
too), the subnet and the gateway from `LinkProperties`, but not the gateway's MAC (Android 10+ hides the ARP table);
Windows `netsh wlan show interfaces` and `arp -a`. Two reports are the same network when subnet and gateway match and
at least one of SSID or gateway-MAC hash agrees where both have it. The id is the hash of the first strong key seen.
The SSID is stored as written (a person reads it in the list; it is not a secret); the gateway MAC only as a hash.

Identity is for **grouping and prediction** ("the TV is on Home Wi-Fi; your phone is not there now"). The decision of
who can reach a target right now is mechanical and direct (§1.4): identities are easy to get subtly wrong (two
`192.168.1.0/24` Fritz!Boxes in two homes), a TCP connection is not.

### 1.4 Choosing the relay

For a cast to thing T, the hub builds the candidates, in this order, and takes the first that passes:

1. **The person's pick**, when they made one (the Cast sheet's "Through" chip; the tool's `via`).
2. **The hub**, when a TCP connection to T's control port (Cast 8009, the DLNA control URL's port) opens within
   800 ms and T's address is on one of the hub's LAN interfaces (so T can reach the door back).
3. **An always-on client** (DocaDesk, doca-client) online now whose `seenFrom` for T is under 24 h old, asked to
   probe the same way (`cast_probe`, §6.2).
4. **A phone** online now with a fresh `seenFrom`, likewise. Last because a phone sleeps, leaves and runs on battery.

A **kept** cast (`keep: true`, the standing screen of cast-and-devices.md) prefers a relay that stays (2, 3); one that
can only go through a phone says so when made: "kept while Al's phone stays on Home Wi-Fi". When the relay of a
running cast goes (the phone leaves the Wi-Fi, the desk sleeps), the hub tries the next candidate once; none, and the
cast is marked `away` with why, visible in the Devices list and Chronicle — never silently gone.

All of this is code (V12): no model chooses a relay.

### 1.5 "Search from"

Machines → Nearby gains a **Look from** chip row: *This hub* and every online client of the person's that lends the
`nearby` family (§6.2), each with the network it is on now. Scan asks the chosen lookers (several at once is fine) and
merges as today; each row shows its `seenFrom`. The same choice is the `nearby` tool's `from` (§5.1). A client's own
UI (DocaMobile's Cast button) scans from itself by default.

**Owner:** Nearby is host-only today (`/api/machines/*`, "the machine's network and radio"). Things seen *from a
member's phone* are that member's home, not the hub's. Proposed: a thing seen only from a person's own devices belongs
to that person (their Nearby, their tool results), a thing seen from the hub stays the admins', and allotment (§5.3)
lends either. Yes?

## 2. Serving the content

### 2.1 The certificate problem, honestly

- **A Cast receiver refuses a self-signed HTTPS certificate** **[verified 2026-10-12, Google Home Max: not fetched]** (Home Assistant's own Cast receiver
  documents that it needs HTTPS with a valid certificate; no sender works around it). The hub's certificate is
  self-signed unless `tailscale cert` succeeded.
- **A Tailscale certificate does not help either.** It is valid, but for `<host>.<tailnet>.ts.net`, which resolves only
  through MagicDNS to a 100.x address the TV cannot route to. Chromecasts commonly use Google's DNS rather than the
  router's **[assumed]**, so a `.local` or a MagicDNS name is not resolved either: **targets are given IP literals**.
- **Plain HTTP works where the receiver is told to load it at the top level or as media.**
  - **Default Media Receiver** (app `CC1AD845`) plays `http://` media: catt serves a local file with Python's
    `BaseHTTPRequestHandler` over plain HTTP (port 45114, `Access-Control-Allow-Origin: *`, Range supported) and casts
    that URL **[verified in catt's source; practice]**. Media elements are passive content, so the receiver's HTTPS
    page loading HTTP media is tolerated **[practice]**.
  - **DashCast** (app `84912283`, namespace `urn:x-cast:com.madmod.dashcast`, message `{url, force, reload,
    reload_time}`) loads a URL in an iframe, or with `force: true` sets `window.location = url` after a second
    **[verified in stestagg/dashcast receiver.html and pychromecast's controller]**. An `http://` page in an iframe of
    the HTTPS receiver page is mixed active content and blocked; **with `force` the page replaces the receiver, a
    top-level HTTP navigation, and loads** **[assumed — to try on the owner's TV]**. The cost of `force`, from
    pychromecast's docstring and catt's comments: the receiver stops listening once the page loaded, so a new URL
    means relaunching the app (catt launches with `force_launch` for this reason). Acceptable: a new page is a new
    cast.
  - DashCast is somebody else's receiver on somebody else's hosting. If it disappears, page casting through Cast stops
    until we register our own (§2.5).
- **DLNA renderers** fetch over plain HTTP; HTTPS support is rare **[assumed]**. HTTP it is.
- **AirPlay** carries the bytes itself (the sender streams), so no certificate is involved; the obstacle is the
  protocol (§3.3).

So the practical rule: **the last hop is plain HTTP on the private network, bound so tightly that it carries one cast
to one address**, and the page it carries is a view session that acts on nothing. A trusted certificate on the LAN is
an option for later (§2.5), not a prerequisite.

### 2.2 The hub's cast door (case one)

`modules/cast/door.js`: a second, plain-HTTP server, **off unless a cast needs it and the owner allowed it**
(`cast.door`: `off` | `on`, default `off`, `propose: false`; S11 — it is a new way in). When on, it listens on a fixed
port (`cast.doorPort`, default 4243) on the hub's **private LAN addresses only** (never the tailnet, never `0.0.0.0`
on a public interface; `listen.isPrivate`), and serves a request only when:

- the peer's address is the address of a **cast running now** (the door keeps `{address → cast}` while the cast lives,
  plus 60 s), and
- the path is one that cast needs: the view link's `GET /api/cast/open/:code`, the static panel files, the reads
  `cast/views.js` allows for that page, the looking POSTs it allows, or `GET /cast/media/:token` (a one-time media
  token, §2.4).

Everything else is a bare 404. An allowed request is handed **to the same Express app** in process
(`http.createServer((req, res) => door.allows(req) ? app(req, res) : notFound(res))`), so the gate, the view session's
`view:<page>` cap and `network.limited` apply unchanged — the peer is a private address, so no machine right is ever
granted through the door. Nothing is proxied through loopback (which would make a LAN peer look local).

Cookies set through the door have no `Secure` flag (it is HTTP; `links.open` already decides by `req.secure`). The
view session is still HttpOnly, SameSite=Strict, read-only and revoked by Stop. Its traffic is readable on the Wi-Fi —
the price of HTTP, said in the Cast sheet the first time ("the page travels unencrypted on Home Wi-Fi").

This replaces the phase-1 idea of turning `network.listen` to `lan` for casting: the door opens one address's view of
one page, not the panel.

### 2.3 A client as the relay (case two)

The relay client runs the same door, its own: a plain-HTTP listener on its LAN address and a random port, alive only
while it relays a cast, with the same rule — the target's address only, the cast's paths only. Each allowed request is
forwarded **byte for byte to the hub** over the client's existing pinned connection (the address in use, failing over
as §2.2 of PROTOCOL says), adding **no token and no cookie of its own**; the hub sees the TV's view session. Three
rewrites are part of the contract, because the browser on the TV believes the relay is the origin:

- `Host` and `Origin` are rewritten to the hub's (the gate compares them for every change; the view page's looking
  POSTs would otherwise be refused);
- `Set-Cookie` loses `Secure` on the way back (the hub answered over HTTPS; the TV holds the cookie over HTTP);
- responses stream (the page's `/api/live/stream` is SSE; a buffering proxy is a frozen page).

"Wherever the original source comes from" falls out of this: the relay only ever fetches from the hub, and the hub
already reaches every source a person may show — its own pages, an agents' computer's served page through a preview
(`canvas/proxy.js`), a desk's file through `/api/devices/:id/files`, an attachment. One shortcut: when the source is
**on the relay itself** (a video on the phone), it serves the file directly, with the same media-token rule, instead of
a round trip through the hub. And a source on the open web (a radio stream, an `.mp4` address) is given to the target
as it is: the TV fetches it itself and nobody relays anything.

### 2.4 Media tokens

`modules/cast/media.js`: `token(source, {for: address, ttlSec, uses})` → `/cast/media/<32 hex>`; the source is an
attachment, a file the person may read, a TTS result, or a live stream (§4.3). Bound to one target address, served with
Range, `Content-Type` from `attachments.playableKind`, gone at the cast's end or `ttlSec` (default 10 min after the last
request). A relay client gets its own token for the same source from the hub and maps it (`cast_serve`, §6.2).

### 2.5 Later: a trusted certificate, and a receiver of our own

Two ways to HTTPS on the LAN, both needing things the project or the owner must provide, so neither is phase A:

- **A name that resolves to the LAN address, with a public certificate**: Plex's `*.plex.direct` pattern — per-hive
  names like `192-168-1-34.<hive-id>.<project domain>` answered by public DNS with the embedded address, certificates
  issued per hive by the project. Some routers block public names resolving to private addresses (DNS-rebind
  protection) **[assumed]**. It needs a project-run DNS and issuing service.
- **The owner's own domain** with a DNS-01 certificate (the "domain as setting" of the v3 decisions): an A record per
  LAN address, a DNS provider key in `keys/`.
- **A DOCA Cast receiver**: a registered Cast app id (a Google Cast developer registration, a public HTTPS page) that
  shows a page and speaks through one custom namespace — no third party's DashCast, and the speaker case gets a proper
  player with a live state. Only worth it once casting is used.

## 3. Protocols per target kind

### 3.1 Google Cast (Cast v2), dependency-free

Built in Node with `tls` alone, as `nearby/mdns.js` was with `dgram` alone (CONSTITUTION's P1, and AGENTS.md's
"seven dependencies that pull their weight"). The same code is reused by doca-client (Node) unchanged.

**Wire** **[verified 2026-10-12 on the Google Home Max: a ~60-line sender in Node with `tls` alone read the receiver's
status, launched the Default Media Receiver, loaded a WAV over plain HTTP from the hub's LAN address (fetched, played,
heard) and stopped it; the same over a self-signed HTTPS address was never fetched]**:

- TLS to `<ip>:8009`; the device's certificate is not verified (senders do not; device authentication is a separate,
  optional namespace a sender may skip — **[practice]**).
- Each message: a 4-byte big-endian length, then a protobuf `CastMessage`:
  `1 protocol_version` (varint, 0 = CASTV2_1_0), `2 source_id` (string), `3 destination_id` (string), `4 namespace`
  (string), `5 payload_type` (varint, 0 = STRING), `6 payload_utf8` (string), `7 payload_binary` (bytes). Only
  varint and length-delimited fields: an encoder and decoder of ~60 lines, no protobuf library.
- Namespaces and messages used:
  - `urn:x-cast:com.google.cast.tp.connection` — `CONNECT` / `CLOSE` (to `receiver-0`, then to the app's
    `transportId`);
  - `urn:x-cast:com.google.cast.tp.heartbeat` — answer `PING` with `PONG`, send `PING` every 5 s, drop after 3 missed;
  - `urn:x-cast:com.google.cast.receiver` — `GET_STATUS`, `LAUNCH {appId}`, `STOP {sessionId}`,
    `SET_VOLUME {volume: {level} | {muted}}`; `RECEIVER_STATUS` carries `applications[].transportId/sessionId/appId`
    and the volume;
  - `urn:x-cast:com.google.cast.media` — `LOAD {media: {contentId, contentType, streamType: BUFFERED|LIVE, metadata},
    autoplay: true}`, `PLAY`, `PAUSE`, `STOP`, `SEEK` with `mediaSessionId`; `MEDIA_STATUS` back;
  - `urn:x-cast:com.madmod.dashcast` — `{url, force: true, reload: false, reload_time: 0}` after `LAUNCH 84912283`.
  Every request carries a `requestId`; answers are matched by it.

**Files** (each under 250 lines): `modules/cast/castv2/frame.js` (protobuf in and out, length framing),
`channel.js` (TLS, heartbeat, request/answer by id, close), `receiver.js` (status, launch, stop, volume),
`media.js` (load and control), `dashcast.js`. `modules/cast/targets/cast.js` turns a cast into those calls:
a page → DashCast with the door's or relay's URL for a view link; audio or video → Default Media Receiver with a media
token URL.

catt stays where it is (W14): `describe.howTo` still names it for a person or a shell, and the `catt` source in Nearby
keeps working. The hub's own sender is the default because it needs nothing installed and its state (what plays, the
volume, the app) is read back mechanically.

**[assumed, to check on the owner's devices]**: the Philips TV with Chromecast built-in runs DashCast and honours
`force`; the Google Home Max plays WAV and MP3 from the door; a TV whose screen is off wakes on `LAUNCH` (Cast usually
does through HDMI-CEC; a Cast-built-in TV may not from standby).

### 3.2 DLNA / UPnP AVTransport

Already half there: `sightings.upnp` keeps the AVTransport control URL. `modules/cast/targets/dlna.js`: SOAP POST to
it — `SetAVTransportURI {InstanceID: 0, CurrentURI, CurrentURIMetaData: DIDL-Lite}` then `Play {Speed: 1}`; `Pause`,
`Stop`; volume through RenderingControl's `SetVolume` when the description lists it. The URI is a media token (§2.4).
Media only: a DLNA renderer shows video and plays audio, it has no browser — a page cast to a DLNA-only TV is offered as
"not this way" with the Cast or TV-browser route if the same thing has one (merge.js already joins a TV's Cast and
UPnP sightings into one row).

### 3.3 AirPlay

- AirPlay 2 (current Apple TVs, HomePods, most licensed speakers) needs HomeKit-style pairing and encrypted streams;
  a dependency-free sender is not a reasonable piece of this project **[practice: pyatv is the reference and it is a
  large library]**.
- The routes that exist: **Home Assistant's Apple TV integration** (pyatv, HA side) as `media_player`; **the person's
  own Apple device** through its share sheet (a device's `apps_open` with a link, route 2 of `play-and-cast`); a
  speaker that also speaks Cast or DLNA (many do).
- AirPlay 1 / RAOP audio to an old receiver or shairport-sync is feasible but narrow; not planned. **Owner:** is there
  an AirPlay-only device in the homes this should serve?

### 3.4 Bluetooth speakers and headsets

Bluetooth reaches only the machine that paired it. So:

- **Paired to the hub** (Nearby's Pair, Linux): it is the hub's own audio output; "play on the hub" through the
  system's player (PipeWire/PulseAudio sink chosen by name) — a hub-side `audio_out` choice beside casting. Rare: hubs
  sit in cupboards.
- **Paired to a phone or a desk**: an output of that client. The hub asks the client to play (§6.2 `media_play` with
  `output`); the client routes to whatever is connected. Two-way headsets are the client's call audio already
  (DocaMobile's `MeetAudio` picks a headset as soon as one is connected).
- A client reports its audio outputs and inputs as part of what it lends (`media_outputs`, §6.2), so the hub's
  targets list shows "Al's earbuds (through Al's phone)".

### 3.5 Home Assistant as the fallback route

When HA sees the thing (`nearby` source `homeassistant`, or the home's `media_player` entity) and no direct route
works, `media_player.play_media {media_content_id: <url>, media_content_type: music|video}` hands HA the URL; HA's own
Cast or DLNA integration does the rest. The URL still has to be reachable by the target, so it is a media token on the
door or the relay; for DOCA's voice, HA's `tts.speak` is *not* used (it would be HA's voice, not the screen's).

`play_media` is **not** in the allow list today (`clients/node/home-shared.js` `ALLOW.media_player`, also the hub's
`home/actions.js`): adding it widens what the home page and a home node will do. **Owner:** add
`media_player.play_media` with `media_content_type` from a short list and `media_content_id` only a URL the hub minted
(a media token) or an `https://` address? (S11: it is a guarded list.)

## 4. Audio endpoints

### 4.1 What each use needs

| Use | Direction | Path | Real-time relay? |
|---|---|---|---|
| DOCA's voice saying something (a notice, `tell_device`'s text, a reminder, "say dinner's ready in the kitchen") | out | the screen's or the thing's voice (`call-voices.js` Quick slot) → one WAV/MP3 → media token → Default Media Receiver / DLNA / a client's player | no — whole sentences, 1–3 s is fine |
| Music and media links | out | an address the target fetches itself (a stream URL), else a media token; a service's own app (YouTube, Spotify) through the phone's app and its Cast button (`play-and-cast` route 2) or Spotify Connect | no |
| The page's sound (Ambient's music, a page reading aloud) | out | a page cast to a **TV** plays its own sound; to a **speaker**, the hub sends what the page would play: its media addresses and its spoken sentences, queued (§4.3) | buffered live |
| Assistant mode on a speaker (Ambient's, with no screen) | in + out | **listening** on a device with a microphone in the room (a phone, a watch, a desk, a wall tablet showing Ambient, a headset); **speaking** on the speaker (§4.2) | yes, one-way out, ~seconds |
| A Live or Deep call on a headset | in + out | the client's own call (`/api/v1/call`, the panel's call) with the headset as its route — nothing new on the hub | the client's, already |
| A meeting on a headset (§23.4) | in + out | the meeting page in the app, `MeetAudio` routes to the headset | the client's, already |
| A headset as a work station | in + out | §4.4 | the client's |

Cast speakers' own microphones (the Home Max has them) are Google's and not reachable by a sender **[practice]**: a
Cast speaker is an output only.

### 4.2 A call that speaks somewhere else

The pipeline (`realtime/pipeline.js`) already makes a call's answer a sentence at a time. A call gains an **output**:

```
wss://<hub>/api/v1/call?output=<nearby thing id>     (also the panel's call: POST /api/chat/call-event {output})
```

The calling device keeps the microphone; the hub synthesizes as today and, instead of sending PCM back in band, puts
the sentences on the thing as a live audio stream (§4.3); `agent` text frames still go to the device (its screen shows
what is said), binary audio frames do not. `interrupted` stops the thing's playback (`STOP` / `PAUSE` on its session).
Two costs, said in the Cast sheet and the call log:

- **Latency**: a Cast speaker buffers a stream before it plays — **[assumed]** 2–5 s. Fine for an answer, poor for a
  back-and-forth. Measured per call (`closed.stats.replyMs` gains `outputMs`, first byte requested by the thing).
- **Echo**: the room's microphone hears the speaker. The panel's call already screens its own echo
  (`_callIsEcho`); the pipeline gets the same check against the sentences it sent to the output.

### 4.3 A live stream to a speaker

`/cast/media/<token>` with `live: true` serves one long `audio/wav` response — a WAV header with an open-ended data
length, then PCM16 as sentences arrive and silence between them (so the connection stays alive) — LOADed with
`streamType: LIVE`. Cast lists WAV among supported formats **[practice]**; an open-ended WAV over HTTP is **[assumed]**
and is the first thing phase A measures. If it fails, the fallback is a sentence per LOAD (a queue on the media
namespace), slower to start each sentence but certain. No encoder dependency either way.

### 4.4 A headset as a work station

A headset connecting to a phone or a desk is an event the client already sees. DocaMobile (and DocaDesk) report it
(`audio.route` on the device's socket, §6.2), and a screen setting decides what it means:
`call.onHeadset`: `nothing` (default) | `offer` (a notice "Start a session with the Orchestrator?") | `call` (open a
Live call to the conversation the person last worked in). Taking the headset off ends nothing by itself: the call
asks once, then ends on its quiet timer as today. A meeting already routes to it. **Owner:** the default — `nothing`
or `offer`?

### 4.5 "From a device, say it on that device" — it just goes through

A person on their watch says "tell the kitchen speaker dinner's ready": the turn is theirs, the thing is allotted to
them (§5.3), so the call runs with no question in Auto, and under the ordinary approvals in Manual (§5.2). No new
hand-off: it is the same `cast say` the agent calls, from the same turn.

## 5. Agent reach

### 5.1 The tools

One new tool, **`cast`** (kit `devices`, `toolbox/cast.js`), and two small widenings:

```
cast { action: 'targets' | 'show' | 'play' | 'say' | 'control' | 'stop' | 'status',
       to: <thing id, its name, or a DOCA screen>, via?: 'hub' | <device id>,
       page?, focus?, keep?,              // show: a panel page through a view link
       url?, file?, attachment?,          // play: media
       text?,                             // say: DOCA's voice
       command?: 'pause'|'resume'|'volume'|'mute'|'next', value? }
```

- `targets` lists, for this person, every place a thing could go now: their DOCA screens (as `cast/routes.js targets`),
  the Nearby things allotted to them with **which relay would carry it** ("via the hub", "via Al's phone — on Home
  Wi-Fi now", "away: last seen from the desk, 2 days ago").
- `show` to a DOCA screen is `screens/showing.show` (the `screen` tool keeps doing it too — W14, one place in code);
  to a Cast TV it makes a view link and casts it through the relay.
- Answers are one sentence: what plays where, through which relay, how to stop it.

`nearby` gains `from: 'hub' | <device id> | 'all'` for `scan`, and its `line` names `seenFrom`. `tell_device` stays
for paired devices (its notices, its files); a notice to a *thing* is `cast say`. Fixed templates, no model (V12).

`turn/fits.js` "What you have" already lists saved things; it adds the relay in one word ("[cast via hub]").

### 5.2 Approvals: casting is outward and audible

- `cast` is **not** in `approval.FREE`: in Manual it is asked like any call that acts. Under Manual's *what matters*,
  `targets`/`status` are reads; `show`/`play`/`stop`/`control` are reversible (Stop undoes them); **`say` and `play`
  with sound on a speaker are outward** — they cannot be unheard by someone in that room — and are asked.
  `risk/rules.js` gains rows for `cast` to say so.
- **A person's own request** (S1, `ctx.byPerson`) to a thing allotted to them is that decision, as `settings_propose
  {asked}` is: in Auto it runs; in Manual what-matters it still asks only for `say` to a thing **in a place the person
  did not name in the request**. The thing's place and room are the person's words, so the check is mechanical.
- **Automatic turns** (the Orchestrator woken by a report, a schedule's turn): only to a thing marked **may speak
  unasked** in Nearby (a per-thing switch, off by default), and never inside its quiet hours (a per-thing
  `quiet: {from, to}`, defaulting to the person's own devices' quiet hours). A reminder the person set fires on a
  thing they chose when setting it.
- **Missions**: `cast` goes in `registry.NEVER` (a sound in a kitchen from work nobody watches is the reason `screen`
  and `ask_device` are there).
- A **volume ceiling** per thing (`maxVolume`, default 0.6) caps what the agent sets; a person's own control in the
  panel is not capped.

**Owner:** is a person's explicit "say X on the kitchen speaker" enough in Manual what-matters, or is every `say` asked
there? And the default of "may speak unasked" — off for every thing, as proposed?

### 5.3 Levels and allotment

A new `allot.js` kind **`nearby`**: ids `n_…` (a saved thing), `place:<name>` (every thing saved in a place, so a new
TV in the living room is lent with it) or `*`. Default as for keys and logins: **admins only**, since today every
thing is the hub's network. A level lists them (`resources.nearby: ['place:Home']`), a grant `use:nearby:<id>` lends
one. With §1.5's answer, things seen only from a person's own devices are theirs without allotment. `reach.js` does not
change: casting to a thing is not the hub's command line. `holdings.js` lists allotted things. This is an
`modules/auth/**` change — **Owner (S11)**.

### 5.4 The panel

- **Cast sheet** (the ⎘ button of cast-and-devices.md, every page's menu): targets grouped by place → room, each with
  its relay chip ("Through: hub ▾"); the page, a sound, or "speak here"; Keep. A target that is away says where it was
  last seen. The same sheet in DocaMobile's web view, until its native sheet (§6.3).
- **Machines → Nearby**: Look from (§1.5), per thing: Cast here, Speak a test sentence, may speak unasked, quiet hours,
  max volume, networks it was seen on.
- **Devices list**: a casting thing is a row with what it shows or plays, its relay, Stop — the same `cast` record the
  view-link screen has (`devices.update(id, {cast})`), plus a record per thing in `cast/running.js` (memory, like
  `showing.js`; a kept cast survives a restart from `cast/kept` in the store and is re-established when its relay
  answers).
- **Every act is a line** (`activity.note`, `machine: {kind: 'nearby', id, name}`, `act: cast|stop|say`), so
  Chronicle and the machines' log say who cast what where (AGENTS.md "A machine is closed only when asked").

### 5.5 What goes to `/api/v1` (W3; the owner's general yes of 2026-10-12 covers the direction, each item still listed)

New panel routes, each with its `rights.js` row and a `capability-map.js` row:

- `GET /api/cast/things` — the targets of §5.1 (right `chat`, narrowed by allotment);
- `POST /api/cast/things/:id {page|url|attachment|text, via, keep}`, `POST …/:id/control`, `POST …/:id/stop`;
- `POST /api/machines/nearby/scan {from}` (host, as today) and `GET /api/cast/networks`.

For devices, mirrored under `/api/v1/cast/*` so a phone's native Cast sheet and a watch's preset ("Workstream on the
living-room TV", cast-and-devices.md §3 controls) use them:

| Route | Scope | Note |
|---|---|---|
| `GET /api/v1/cast/targets` | `harness:chat` | what this device's person may cast to, with relays |
| `POST /api/v1/cast` `{to, page\|url\|mediaId\|text, via?, keep?}` | **`cast:send`** (new) | 202 `{castId}`; outcome as event `cast.state` |
| `POST /api/v1/cast/{id}/control`, `DELETE /api/v1/cast/{id}` | `cast:send` | |

`cast:send` is a new scope family: **S11 / W3, the owner's yes** — and which presets carry it (proposed: `phone`;
`watch` only through a control preset, which runs as its person anyway). The alternative is to put casting under
`harness:chat`; rejected because a token that may talk to the agent should not by that alone make sound in a room.

## 6. Clients as lookers and relays

### 6.1 Why families, not new scopes

A home node (PROTOCOL §22.4) showed the shape: a client lends a **family** over `mcp:self`, the hub calls its tools on
the device's own socket (§22.2), pushes come back as `notifications/doca/<family>`. Looking and relaying for casts are
two more families. No new scope, no caps field — but new family names and tools are a protocol change (§22.1's table,
`api-v1/families.js`, the fixtures): **W3**, inside the owner's yes for phase work.

### 6.2 The contracts

Family **`nearby`** (asked once per device, like every family):

- `nearby_network {}` → `{network: {ssid|null, subnet, gateway, gatewayMacHash|null, kind: wifi|ethernet}, at}`
- `nearby_scan {sources?: ['cast','mdns','ssdp','bluetooth'], ms?}` → `{things: [sighting…], network, why: {source: text}}`
  — sightings in the hub's own shape (`nearby/sightings.js`; a test holds the clients' fixtures to it), so `merge.js`
  joins them unchanged.
- `cast_probe {address, port}` → `{open: bool, ms}` — a TCP connect, nothing sent.
- Pushes: `notifications/doca/nearby {what: 'network', network}` when the device changes network (the hub moves its
  relays at once), `{what: 'seen', things}` after a scan the person started on the device.

Family **`cast`**:

- `cast_serve {cast, target: address, upstream: [{path, token?}], live?}` → `{base: 'http://192.168.1.20:41234'}` —
  open (or reuse) the device's door for that target (§2.3 rules and rewrites).
- `cast_send {target: {address, port, kind: cast|dlna, control?}, do: 'page'|'media'|'stop'|'pause'|'resume'|'volume',
  url?, contentType?, streamType?, value?}` → `{ok, state: {app, playing, volume}}` — the device's own Cast v2 / DLNA
  sender (doca-client reuses `modules/cast/castv2`; DocaMobile and DocaDesk port it, §6.3).
- `cast_end {cast}` → `{ok}` — close the door for that cast.
- Pushes: `notifications/doca/cast {cast, state: playing|paused|ended|failed, why?}`.

Family **`media`** (exists, `media_control`) gains:

- `media_outputs {}` → `{outputs: [{id, name, kind: speaker|headset|earpiece|bluetooth|cast, connected, input: bool}]}`
- `media_play {url|token, output?, volume?}` → `{ok}` — on the device or one of its outputs (a Bluetooth speaker).
- Push `notifications/doca/media {what: 'route', outputs}` (a headset came or went: §4.4).

A tool that makes sound (`media_play`, `cast_send` with media) is not added to `families.DECIDES` (that list is for
controls on a screen a person sees): the hub's own `cast` approvals (§5.2) are what ask, before the tool is called,
and the device refuses any of them when its person switched the family off.

Fixtures (`npm run fixtures`): `nearby-network`, `nearby-scan`, `cast-serve`, `cast-state`, `media-outputs`, written
by the hub's code, held to the OpenAPI schemas and to the clients' copies (`test/client-fixtures.test.js`).

### 6.3 Per client

- **doca-client** (`clients/node`, this repository): first, because it is Node and the hub's Cast v2, door and
  sighting code are reused as they are, and CI runs it on three OSes. A mini PC or a desk at home is the always-on
  relay the hosted hive needs.
- **DocaMobile**: the families in `:core-doca` (JVM, testable with MockWebServer against the same fixtures), mDNS with
  `NsdManager` and a multicast lock (`CHANGE_WIFI_MULTICAST_STATE` — a new permission), a small HTTP door (a socket
  server in Kotlin, no NanoHTTPD needed), a foreground service of type `dataSync` while it relays a kept cast. Its
  native Cast sheet uses `/api/v1/cast/*`. **Owner:** the Cast sender — our own Cast v2 port (no Google Play services
  dependency, the same behaviour as the hub, tested on the JVM) or Google's Cast SDK (MediaRouter's picker, the system
  output switcher, needs a registered app id)? Proposed: our own, with the SDK as a later alternative.
- **DocaDesk**: the same families in `DocaDesk.Mcp` (C#), its door on `TcpListener` as its MCP listener already is.
- **DocaWear**: no families; casting from the wrist is a control in a preset calling `/api/v1/cast` through the phone.

## 7. Phasing

**Phase A — the hub alone, for things on its own network** (no client changes):

1. `cast/castv2/*`, `cast/targets/{cast,dlna}.js`, `cast/media.js`, `cast/running.js`; the door (`cast.door`, off,
   owner's switch). Page to a Cast TV through DashCast with `force`; media and DOCA's voice to the Default Media
   Receiver; DLNA play; control and stop; kept casts restored at start.
2. The hub's own network identity and `seenFrom: hub`; relay choice with only the hub as candidate.
3. The `cast` tool, its approvals rows, NEVER, the panel's Cast sheet for things, Nearby's per-thing settings.
4. Measured on the owner's two devices with the test account: DashCast `force` on the Philips TV, WAV and MP3 on the
   Home Max, open-ended WAV live, time to first sound, a TV in standby.

**Phase B — doca-client as looker and relay**: families `nearby` and `cast`, network reports, Look from, relay
choice across devices, the "away" state. A hosted hive casts through a home mini PC.

**Phase C — DocaMobile**: the same families, the native Cast sheet over `/api/v1/cast/*`, `media_outputs` and
`media_play` to Bluetooth outputs, the headset event (§4.4). Then **DocaDesk**.

**Phase D — calls with an output** (§4.2, §4.3): a call that listens on one device and speaks on a speaker; Ambient's
assistant on a speaker-only room.

**Phase E — if wanted**: a trusted LAN certificate, a DOCA Cast receiver, AirPlay through HA.

## 8. Tests

- **A Cast device simulator**, `test/fixtures/cast-stub.js`: a TLS server (a throwaway certificate made the way
  `https-cert.js` makes the self-signed one) speaking the framing and the namespaces above — answers `CONNECT`, `PING`,
  `GET_STATUS`, `LAUNCH` (DashCast and the DMR), `LOAD`, `SET_VOLUME`; records what it got; and, like a real receiver,
  **fetches the `contentId` / DashCast URL from its own address**, so a test proves the door served the page or the
  media and that a request from another address got a 404. `castv2/frame.js` is also tested against byte strings
  captured from pychromecast's encoder (fixtures, not a Python dependency).
- **A DLNA stub**: an SSDP answer, a device description with AVTransport, a SOAP endpoint that records
  `SetAVTransportURI` and `Play`, and fetches the URI.
- **A relay client stub** over the device socket (§22.2), answering `nearby_*` / `cast_*` from fixtures, to test relay
  choice, the away state and failover without a phone; and **doca-client for real** (as `test/doca-client.test.js`
  already pairs one) relaying to the Cast stub, checking the three rewrites (Host/Origin, `Secure`, streaming SSE).
- Door rules: every path not in the view's list refused; machine rights refused (`network.limited`) through the door;
  the cookie without `Secure`; the token's address binding and expiry.
- Approval and allotment: `test/cast-tool.test.js` — a person's request, an automatic turn, a mission (absent), quiet
  hours, the volume ceiling, a member without the kind.
- **On real hardware**, before each phase is called done (W8): the two saved devices, a phone on a second Wi-Fi with
  the hub off-LAN (a sandbox hub, never the live one, for the door switch), a Bluetooth speaker paired to the phone.

## 9. Owner decisions

1. **The hub's cast door** (§2.2): a plain-HTTP listener on the LAN, off by default, serving only the running casts'
   addresses and paths — may it exist, and is the page travelling unencrypted on the home Wi-Fi acceptable for a
   read-only view? (S11: a new way in.)
2. **Relays on clients** (§2.3): the phone or desk opening the same door on its Wi-Fi while it relays — yes? (It is
   the "served through the phone" of cast-and-devices.md, with the rewrites spelled out.)
3. **Whose things** (§1.5): things seen only from a person's own devices are theirs; the hub's stay the admins'.
4. **Allotment kind `nearby`** (§5.3), admins-only by default, `place:` ids — an `auth/**` change.
5. **`cast:send` scope** (§5.5) and which presets carry it (proposed: `phone`).
6. **Approvals** (§5.2): a person's explicit `say` to a named place runs without a question in Manual what-matters;
   "may speak unasked" per thing, off by default; `cast` in `registry.NEVER`.
7. **`media_player.play_media`** in Home Assistant's allow list (§3.5), URLs limited to the hub's tokens and `https://`.
8. **DocaMobile's Cast sender** (§6.3): our own Cast v2 port, or Google's Cast SDK.
9. **DashCast** (§2.1): relying on a third party's receiver for page casting until (if) DOCA registers its own.
10. **A headset connecting** (§4.4): default `nothing` or `offer`.
11. **AirPlay-only devices** (§3.3): any in the homes this must serve? If not, AirPlay stays HA's.
12. **A trusted certificate on the LAN** (§2.5): wanted at all, and through the owner's domain or a project service?

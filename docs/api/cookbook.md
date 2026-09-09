# Cookbook: the Doca client API in JavaScript, Kotlin, Swift and Python

Copy-paste starting points for the four environments people actually build
Doca clients in. Every snippet talks to the real endpoints described in
[`PROTOCOL.md`](../../PROTOCOL.md); nothing here is SDK magic. Prefer generating
a typed client from [`openapi.json`](openapi.json) for anything larger
(`openapi-generator`, `orval`, `openapi-typescript`, `swift-openapi-generator`,
`kotlinx-serialization` + `ktorfit` all consume it).

Conventions used throughout:

- `BASE` = `https://<host>:4242/api/v1`, `TOKEN` = `doca_<device>.<secret>`.
- The server certificate is self-signed or Tailscale-issued; in development you
  disable verification, in production you pin it or install the Tailscale CA.
- All examples send `X-Doca-Client` so the server can tell your app apart in logs.

Contents: [JavaScript](#javascript-browser-and-node) · [Kotlin (Wear OS / Android)](#kotlin-wear-os--android) · [Swift (watchOS / iOS)](#swift-watchos--ios) · [Python (agent)](#python-agent-side)

---

## JavaScript (browser and Node)

Works unchanged in Node ≥ 18 and modern browsers (`fetch`, `FormData`,
`ReadableStream`). Browser-only: `EventSource` with `?access_token=`.

### A minimal client

```js
// doca.js
export class Doca {
  constructor(base, token, client = 'my-app/1.0') { this.base = base; this.token = token; this.client = client; }

  async call(method, path, body, extraHeaders = {}) {
    const headers = { 'X-Doca-Client': this.client, ...extraHeaders };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (body instanceof FormData) payload = body;                       // multipart: let fetch set the boundary
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    if (res.status === 304) return { status: 304 };
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : type.startsWith('image/') || type.includes('octet') ? await res.arrayBuffer() : await res.text();
    if (!res.ok) { const e = new Error(data?.error?.message || res.statusText); Object.assign(e, { status: res.status, code: data?.error?.code, body: data }); throw e; }
    return { status: res.status, data, etag: res.headers.get('etag') };
  }
  get(path, headers)   { return this.call('GET', path, undefined, headers); }
  post(path, body)     { return this.call('POST', path, body); }
  patch(path, body)    { return this.call('PATCH', path, body); }
  put(path, body, h)   { return this.call('PUT', path, body, h); }
  delete(path)         { return this.call('DELETE', path); }
}
```

### Pairing (device side, no token yet)

```js
const doca = new Doca(BASE, null, 'watchface/1.0');
const { data } = await doca.post('/devices/pair/complete', {
  code: '641-598',                                           // typed by the user or parsed from doca://pair?code=641598&host=…
  name: 'my-watch',
  caps: { formFactor: 'watch', screen: { w: 450, h: 450, shape: 'round' }, input: { touch: true, voice: true },
          audio: { mic: true, haptic: true }, render: ['image', 'sprite'], motion: ['1'], exec: ['js'], sensors: ['heartRate', 'battery'] },
});
secureStore.set('doca.token', data.token);                   // Keychain / Keystore / IndexedDB+WebCrypto — never localStorage in the clear
doca.token = data.token;
```

### First screen: capabilities → profile → snapshot

```js
const caps    = (await doca.get('/capabilities')).data;
const profile = (await doca.get('/devices/me/profile')).data.profile;
const page    = profile.pages[0];
const ids     = page.surfaces.map(s => typeof s === 'string' ? s : s.id).join(',');
const snap    = await doca.get(`/snapshot?surfaces=${ids}&spark=1`);

// Build widgets from the dictionary, not from hard-coded ids.
const defs = Object.fromEntries(caps.surfaces.map(s => [s.id, s]));
for (const surface of snap.data.surfaces) {
  for (const m of surface.metrics) {
    const level = (m.thresholds || []).filter(t => m.value != null && m.value >= t.gte).pop()?.level; // 'warn' | 'crit' | undefined
    draw(m.label, m.display, { fill: m.kind === 'gauge' ? m.value / (m.max ?? 100) : null, level, stale: m.stale, spark: m.spark });
  }
}
```

### The push loop (Node or browser, using fetch + streams)

```js
export async function pushLoop(doca, { cursor = 0, onEvent, onResync, signal }) {
  let backoff = 1000;
  while (!signal?.aborted) {
    try {
      const res = await fetch(`${doca.base}/events?since=${cursor}`, { headers: { Authorization: `Bearer ${doca.token}`, Accept: 'text/event-stream' }, signal });
      if (res.status === 401) throw Object.assign(new Error('revoked'), { fatal: true });
      backoff = 1000;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '', lastByte = Date.now();
      const watchdog = setInterval(() => { if (Date.now() - lastByte > 2 * 25_000) reader.cancel(); }, 5000);
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          lastByte = Date.now(); buf += value;
          let i; while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = {}; for (const line of frame.split('\n')) { const j = line.indexOf(':'); if (j <= 0) continue; ev[line.slice(0, j)] = line.slice(j + 1).trim(); }
            if (!ev.event) continue;                                       // ": ping" heartbeat
            const data = ev.data ? JSON.parse(ev.data) : {};
            if (ev.event === 'hello') { if (data.resync) { await onResync?.(data.cursor); cursor = data.cursor; } continue; }
            if (ev.event === 'close') { if (data.reason === 'revoked') throw Object.assign(new Error('revoked'), { fatal: true }); break; }
            if (ev.event === 'resync') { await onResync?.(data.payload.cursor); cursor = data.payload.cursor; continue; }
            await onEvent(data);                                           // full envelope: { seq, type, class, payload, … }
            cursor = data.seq; await persist('doca.cursor', cursor);
          }
        }
      } finally { clearInterval(watchdog); }
    } catch (e) {
      if (e.fatal || signal?.aborted) throw e;
      await new Promise(r => setTimeout(r, backoff * (0.8 + Math.random() * 0.4)));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}
```

In a browser tab you can use the built-in `EventSource` instead (it reconnects by
itself and sends `Last-Event-ID`); the token has to go in the URL because
`EventSource` cannot set headers, and this is the only endpoint that accepts it:

```js
const es = new EventSource(`${BASE}/events?since=${cursor}&access_token=${encodeURIComponent(token)}`);
es.addEventListener('prompt.new', e => showPrompt(JSON.parse(e.data).payload.prompt));
es.addEventListener('surface.update', e => updateSurface(JSON.parse(e.data).payload.surface));
es.addEventListener('close', () => es.close());
```

### Prompt cycle

```js
async function onPromptNew(prompt) {
  render(prompt);                                                    // title, body blocks, one control per choice
}

async function choose(prompt, choice, input) {
  const selectionId = crypto.randomUUID(); await persist(`sel:${prompt.id}`, selectionId);
  let body;
  if (choice.type === 'option' || choice.type === 'dismiss') body = { selectionId, choiceId: choice.id };
  else if (choice.type === 'text')  body = { selectionId, choiceId: choice.id, payload: { kind: 'text', text: input.text } };
  else if (choice.type === 'voice' && input.transcript) body = { selectionId, choiceId: choice.id, payload: { kind: 'voice', transcript: input.transcript } };
  else {                                                             // voice clip or image: multipart
    body = new FormData();
    body.set('selectionId', selectionId); body.set('choiceId', choice.id);
    body.set('payload', JSON.stringify(choice.type === 'voice' ? { kind: 'voice', durationMs: input.durationMs } : { kind: 'image', caption: input.caption }));
    body.set(choice.type === 'voice' ? 'audio' : 'image', input.blob, choice.type === 'voice' ? 'clip.ogg' : 'photo.jpg');
  }
  try {
    const r = await doca.post(`/prompts/${prompt.id}/select`, body);
    if (r.data.status === 'outcome_ready') return showOutcome(prompt, selectionId, r.data.outcome);
    if (r.data.status === 'pending')       return showSpinner(prompt, r.data.stage);   // outcome arrives as prompt.outcome
    if (r.data.status === 'dismissed')     return remove(prompt.id);
  } catch (e) {
    if (e.status === 409 || e.code === 'choice_not_available') return refresh(prompt.id);   // GET /prompts/:id and re-render its state
    throw e;
  }
}

async function confirm(promptId, selectionId, decision /* 'confirm' | 'back' */) {
  const r = await doca.post(`/prompts/${promptId}/confirm`, { selectionId, decision });
  if (r.data.status === 'open') return refresh(promptId);
  if (r.data.execution?.jobId) watchJob(r.data.execution.jobId);            // job.progress / job.done events, or GET /jobs/:id
  remove(promptId);
}
```

### Reporting sensors, updating variables, receiving an artifact

```js
// sensor.request event → start sampling → batch every second
async function onSensorRequest({ request }) {
  const stop = startSensors(request.sensors, async batch => {
    await doca.post('/sensors/samples', { requestId: request.id, samples: batch });   // [{ sensor, ts, value | values }]
  });
  setTimeout(stop, Math.max(...request.sensors.map(s => s.durationSec)) * 1000);
  stopHandlers.set(request.id, stop);                                                 // sensor.stop { requestId } → stop()
}

await doca.patch('/devices/me/vars', { batteryPct: 58, wristRaised: true });

// artifact.deliver event → verify → run in a sandbox (browser Worker shown; Node: `node:vm` or a worker_thread)
async function onArtifact({ artifact, inline, inlineEncoding }) {
  let code = inline && inlineEncoding !== 'base64' ? inline : new TextDecoder().decode(await (await doca.get(`/artifacts/${artifact.id}/content`)).data);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (!hash.startsWith(artifact.sha256)) throw new Error('artifact hash mismatch');
  const worker = new Worker(URL.createObjectURL(new Blob([code.replace(/^export\s+/mg, '') + `;onmessage = e => postMessage(${artifact.entry}(...e.data));`], { type: 'text/javascript' })));
  worker.onmessage = e => doca.post('/messages', { type: `${artifact.name}.result`, payload: e.data });
  worker.postMessage([rrIntervals]);                                                  // whatever `params`/`purpose` describe
}
```

### Server-rendered chart

```js
const { w, h, round } = caps.render.defaults;
const png = (await doca.get(`/render/chart?metrics=system.cpu.pct,system.memory.pct&w=${w}&h=${Math.round(h / 2)}${round ? '&round=1' : ''}`)).data; // ArrayBuffer
```

---

## Kotlin (Wear OS / Android)

OkHttp for HTTP, `okhttp-sse` for the stream, `kotlinx.serialization` for JSON.
Store the token in `EncryptedSharedPreferences` or the Keystore.

```kotlin
// build.gradle: implementation("com.squareup.okhttp3:okhttp:4.12.0"); implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
//               implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.UUID

class Doca(private val base: String, var token: String?, private val http: OkHttpClient) {
    private val json = Json { ignoreUnknownKeys = true }                    // forward-compatibility rule #1
    private val JSON = "application/json".toMediaType()

    private fun req(path: String) = Request.Builder().url(base + path).header("X-Doca-Client", "watchface/1.0")
        .apply { token?.let { header("Authorization", "Bearer $it") } }

    fun call(method: String, path: String, body: JsonElement? = null, headers: Map<String, String> = emptyMap()): JsonObject {
        val b = req(path).method(method, body?.let { json.encodeToString(JsonElement.serializer(), it).toRequestBody(JSON) }
            ?: if (method == "GET") null else "".toRequestBody(null))
        headers.forEach { (k, v) -> b.header(k, v) }
        http.newCall(b.build()).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse { buildJsonObject {} }
            if (!res.isSuccessful) throw DocaError(res.code, obj["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content, obj)
            return obj
        }
    }
    class DocaError(val status: Int, val code: String?, val body: JsonObject) : Exception("$status $code")

    // ── Pairing ──
    fun pair(code: String, caps: JsonObject): String {
        val r = call("POST", "/devices/pair/complete", buildJsonObject { put("code", code); put("name", "my-watch"); put("caps", caps) })
        token = r["token"]!!.jsonPrimitive.content
        return token!!
    }

    // ── Prompts ──
    fun selectOption(promptId: String, choiceId: String, selectionId: String = UUID.randomUUID().toString()) =
        call("POST", "/prompts/$promptId/select", buildJsonObject { put("selectionId", selectionId); put("choiceId", choiceId) })

    fun selectVoice(promptId: String, choiceId: String, ogg: ByteArray, durationMs: Int, selectionId: String = UUID.randomUUID().toString()): JsonObject {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("selectionId", selectionId).addFormDataPart("choiceId", choiceId)
            .addFormDataPart("payload", """{"kind":"voice","durationMs":$durationMs}""")
            .addFormDataPart("audio", "clip.ogg", ogg.toRequestBody("audio/ogg".toMediaType())).build()
        http.newCall(req("/prompts/$promptId/select").post(form).build()).execute().use { return json.parseToJsonElement(it.body!!.string()).jsonObject }
    }

    fun confirm(promptId: String, selectionId: String, decision: String = "confirm") =
        call("POST", "/prompts/$promptId/confirm", buildJsonObject { put("selectionId", selectionId); put("decision", decision) })

    // ── Sensors / vars ──
    fun report(requestId: String?, samples: JsonArray) =
        call("POST", "/sensors/samples", buildJsonObject { requestId?.let { put("requestId", it) }; put("samples", samples) })
    fun vars(patch: JsonObject) = call("PATCH", "/devices/me/vars", patch)

    // ── Push channel (SSE). Reconnect with the persisted cursor; okhttp-sse honours `retry:` and sends Last-Event-ID. ──
    fun stream(since: Long, onEvent: (type: String, envelope: JsonObject) -> Unit, onClosed: () -> Unit): EventSource {
        val client = http.newBuilder().readTimeout(java.time.Duration.ofSeconds(60)).build()   // > 2 × heartbeat (25 s)
        val request = req("/events?since=$since").header("Accept", "text/event-stream").build()
        return EventSources.createFactory(client).newEventSource(request, object : EventSourceListener() {
            override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
                val obj = json.parseToJsonElement(data).jsonObject
                when (type) {
                    "hello" -> if (obj["resync"]?.jsonPrimitive?.booleanOrNull == true) onEvent("resync", obj)
                    "close" -> { es.cancel(); onClosed() }
                    null -> Unit                                                     // heartbeat comment
                    else -> onEvent(type, obj)                                       // caller persists obj["seq"]
                }
            }
            override fun onFailure(es: EventSource, t: Throwable?, response: Response?) { onClosed() }   // caller backs off and reconnects
        })
    }
}
```

Reporting the accelerometer at the requested rate with `SensorManager`:

```kotlin
fun startAccelerometer(ctx: Context, rateHz: Int, durationSec: Int, onBatch: (JsonArray) -> Unit): () -> Unit {
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    val batch = mutableListOf<JsonObject>()
    val listener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            batch += buildJsonObject {
                put("sensor", "accelerometer"); put("ts", java.time.Instant.now().toString())
                put("values", buildJsonArray { e.values.take(3).forEach { add(it) } }); put("accuracy", e.accuracy)
            }
            if (batch.size >= rateHz) { onBatch(JsonArray(batch.toList())); batch.clear() }   // ~1 s per POST
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    sm.registerListener(listener, sensor, 1_000_000 / rateHz)
    val stop = { sm.unregisterListener(listener); if (batch.isNotEmpty()) onBatch(JsonArray(batch.toList())) }
    Handler(Looper.getMainLooper()).postDelayed(stop, durationSec * 1000L)
    return stop
}
```

Rendering a motion `ring` track with Compose:

```kotlin
@Composable
fun Ring(track: JsonObject) {              // { type:"ring", from, to, durationMs, easing, color }
    val target = track["to"]!!.jsonPrimitive.float
    val progress by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(track["durationMs"]!!.jsonPrimitive.int, easing = when (track["easing"]?.jsonPrimitive?.content) {
            "linear" -> LinearEasing; "ease-in" -> FastOutLinearInEasing; "ease-out" -> LinearOutSlowInEasing; else -> FastOutSlowInEasing }),
        label = "ring")
    CircularProgressIndicator(progress = { progress }, color = palette(track["color"]?.jsonPrimitive?.content))   // you own the palette
}
```

---

## Swift (watchOS / iOS)

`URLSession` with `async/await`; the SSE reader uses `bytes(for:)` and splits on
blank lines. Store the token in the Keychain.

```swift
import Foundation

struct DocaError: Error { let status: Int; let code: String?; let body: [String: Any] }

final class Doca {
    let base: URL; var token: String?
    // Development only: trust the self-signed certificate. In production pin it instead.
    private let session: URLSession
    init(base: URL, token: String?) {
        self.base = base; self.token = token
        self.session = URLSession(configuration: .default, delegate: InsecureTrust(), delegateQueue: nil)
    }

    private func request(_ method: String, _ path: String, json: Any? = nil, headers: [String: String] = [:]) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = method
        r.setValue("watchface/1.0", forHTTPHeaderField: "X-Doca-Client")
        if let t = token { r.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        headers.forEach { r.setValue($1, forHTTPHeaderField: $0) }
        if let json { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try? JSONSerialization.data(withJSONObject: json) }
        return r
    }

    func call(_ method: String, _ path: String, json: Any? = nil, headers: [String: String] = [:]) async throws -> [String: Any] {
        let (data, resp) = try await session.data(for: request(method, path, json: json, headers: headers))
        let http = resp as! HTTPURLResponse
        let obj = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200..<300).contains(http.statusCode) || http.statusCode == 304 else {
            throw DocaError(status: http.statusCode, code: (obj["error"] as? [String: Any])?["code"] as? String, body: obj)
        }
        return obj
    }

    // ── Pairing ──
    func pair(code: String, caps: [String: Any]) async throws {
        let r = try await call("POST", "devices/pair/complete", json: ["code": code, "name": "my-watch", "caps": caps])
        token = r["token"] as? String                                  // → Keychain
    }

    // ── Prompts ──
    func select(promptId: String, choiceId: String, payload: [String: Any]? = nil, selectionId: String = UUID().uuidString) async throws -> [String: Any] {
        var body: [String: Any] = ["selectionId": selectionId, "choiceId": choiceId]
        if let payload { body["payload"] = payload }                    // e.g. ["kind": "voice", "transcript": text] with on-device SFSpeechRecognizer
        return try await call("POST", "prompts/\(promptId)/select", json: body)
    }

    func selectImage(promptId: String, choiceId: String, jpeg: Data, caption: String?, selectionId: String = UUID().uuidString) async throws -> [String: Any] {
        let boundary = "doca-\(UUID().uuidString)"
        var r = request("POST", "prompts/\(promptId)/select")
        r.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var b = Data()
        func field(_ name: String, _ value: String) { b.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!) }
        field("selectionId", selectionId); field("choiceId", choiceId)
        field("payload", String(data: try JSONSerialization.data(withJSONObject: ["kind": "image", "caption": caption ?? ""]), encoding: .utf8)!)
        b.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        b.append(jpeg); b.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        r.httpBody = b
        let (data, _) = try await session.data(for: r)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    func confirm(promptId: String, selectionId: String, decision: String = "confirm") async throws -> [String: Any] {
        try await call("POST", "prompts/\(promptId)/confirm", json: ["selectionId": selectionId, "decision": decision])
    }

    // ── Push channel ──
    /// Yields envelopes; ends on `close`. Caller persists `seq` and reconnects with backoff.
    func events(since: Int) -> AsyncThrowingStream<[String: Any], Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                var r = request("GET", "events?since=\(since)")
                r.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                r.timeoutInterval = 60                                  // > 2 × heartbeat (25 s)
                let (bytes, resp) = try await session.bytes(for: r)
                guard (resp as! HTTPURLResponse).statusCode == 200 else { throw DocaError(status: (resp as! HTTPURLResponse).statusCode, code: nil, body: [:]) }
                var event = "", data = ""
                for try await line in bytes.lines {
                    if line.isEmpty {                                    // end of frame
                        defer { event = ""; data = "" }
                        guard !event.isEmpty, let d = data.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { continue }
                        if event == "close" { continuation.finish(); return }
                        if event == "hello" { if obj["resync"] as? Bool == true { continuation.yield(["type": "resync", "payload": obj]) }; continue }
                        continuation.yield(obj)
                    } else if line.hasPrefix("event:") { event = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
                    else if line.hasPrefix("data:") { data += line.dropFirst(5).trimmingCharacters(in: .whitespaces) }
                    // "id:" is the seq (also inside data), ": ping" lines are heartbeats
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Development only.
final class InsecureTrust: NSObject, URLSessionDelegate {
    func urlSession(_ s: URLSession, didReceive c: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard let trust = c.protectionSpace.serverTrust else { return (.performDefaultHandling, nil) }
        return (.useCredential, URLCredential(trust: trust))
    }
}
```

Driving it from SwiftUI, including a `morph` motion track:

```swift
@MainActor final class Model: ObservableObject {
    @Published var prompts: [String: [String: Any]] = [:]
    @Published var cpu: Double = 0
    let doca: Doca; var cursor = UserDefaults.standard.integer(forKey: "doca.cursor")

    init(doca: Doca) { self.doca = doca }

    func run() async {
        var backoff: UInt64 = 1
        while !Task.isCancelled {
            do {
                for try await env in doca.events(since: cursor) {
                    let payload = env["payload"] as? [String: Any] ?? [:]
                    switch env["type"] as? String {
                    case "prompt.new":     if let p = payload["prompt"] as? [String: Any], let id = p["id"] as? String { prompts[id] = p }
                    case "prompt.closed":  prompts.removeValue(forKey: payload["promptId"] as? String ?? "")
                    case "surface.update": if let m = ((payload["surface"] as? [String: Any])?["metrics"] as? [[String: Any]])?.first(where: { $0["id"] as? String == "system.cpu.pct" }) {
                                               withAnimation(.easeOut(duration: 0.6)) { cpu = (m["value"] as? Double) ?? 0 } }   // a `morph`, done natively
                    case "revoked":        Keychain.delete("doca.token"); return
                    default: break                                       // unknown types are fine
                    }
                    if let seq = env["seq"] as? Int { cursor = seq; UserDefaults.standard.set(seq, forKey: "doca.cursor") }
                }
                backoff = 1
            } catch { try? await Task.sleep(nanoseconds: backoff * 1_000_000_000); backoff = min(backoff * 2, 60) }
        }
    }
}
```

On watchOS, hold the stream only while the app is active; in an
`WKExtendedRuntimeSession` or background refresh, call
`GET /events?since=` without the `Accept` header and process the JSON page.

---

## Python (agent side)

`requests` only. The stream reader is a dozen lines; `sseclient-py` works too.

```python
# doca_agent.py
import json, os, time, uuid, requests

BASE  = os.environ.get("DOCA_URL", "https://localhost:4242") + "/api/v1"
TOKEN = os.environ["DOCA_TOKEN"]                       # npm run token -- issue --name agent --preset agent --kind agent
VERIFY = os.environ.get("DOCA_CA", False)              # path to the CA/cert, or False in development

S = requests.Session()
S.headers.update({"Authorization": f"Bearer {TOKEN}", "X-Doca-Client": "my-agent/1.0"})
S.verify = VERIFY

class DocaError(Exception):
    def __init__(self, r):
        body = r.json() if "json" in r.headers.get("content-type", "") else {}
        self.status, self.code, self.body = r.status_code, body.get("error", {}).get("code"), body
        super().__init__(f"{r.status_code} {self.code}: {body.get('error', {}).get('message')}")

def api(method, path, **kw):
    r = S.request(method, BASE + path, **kw)
    if not r.ok: raise DocaError(r)
    return r.json() if r.content else {}

# ── Who is out there? ──
devices = api("GET", "/agent/devices")["devices"]
watch = next(d for d in devices if d["caps"].get("formFactor") == "watch")

# ── Raise a prompt (idempotent by id: re-running within the same minute returns the existing prompt instead of nagging) ──
prompt = api("POST", "/agent/prompts", json={
    "id": "gpu-temp-" + time.strftime("%Y%m%dT%H%M"),
    "title": "GPU 0 has been at 97 °C for 10 min", "priority": "high", "targets": [watch["id"]],
    "resolver": "agent", "allowedCommands": ["services.stop"],
    "body": [{"type": "text", "text": "vLLM is the only tenant. What should I do?"}],
    "choices": [
        {"id": "stop", "type": "option", "label": "Stop vLLM",
         "outcome": {"summary": "Stop container doca-vllm", "action": {"commandId": "services.stop", "params": {"id": "vllm"}}, "confirmLabel": "Stop it"}},
        {"id": "wait", "type": "option", "label": "Wait 10 min", "outcome": {"summary": "Re-check in 10 minutes"}},
        {"id": "say",  "type": "voice",  "label": "Tell me", "maxSec": 20},
        {"id": "type", "type": "text",   "label": "Type instead"},
        {"id": "no",   "type": "dismiss","label": "Ignore"},
    ],
})["prompt"]
print("delivered to", prompt["delivered"])

# ── Resolve free-form answers ──
def decide(payload: dict) -> dict:
    said = (payload.get("text") or payload.get("transcript") or "").lower()
    if "stop" in said:
        return {"summary": "Stop container doca-vllm", "action": {"commandId": "services.stop", "params": {"id": "vllm"}}, "confirmLabel": "Stop it"}
    if payload.get("kind") == "image":
        img = S.get(BASE + payload["mediaUrl"]).content       # bytes for your vision model
        return {"summary": f"Looked at your photo ({len(img)} bytes) — no action"}
    return {"summary": f'Noted: "{said[:60]}" — nothing to run', "confirmLabel": "OK"}

# ── Push channel ──
def events(since=0):
    """Yield envelopes; returns when the server closes the stream. Reconnect with the last seq."""
    with S.get(BASE + f"/events?since={since}", headers={"Accept": "text/event-stream"}, stream=True, timeout=60) as r:
        r.raise_for_status()
        event, data = None, ""
        for line in r.iter_lines(decode_unicode=True):
            if line == "":
                if event and event not in ("hello", "close") and data: yield json.loads(data)
                if event == "close": return
                event, data = None, ""
            elif line.startswith("event:"): event = line[6:].strip()
            elif line.startswith("data:"):  data += line[5:].strip()
            # ": ping" → heartbeat; "id:" duplicates env["seq"]

cursor = 0
while True:
    try:
        for env in events(cursor):
            cursor = env["seq"]
            t, p = env["type"], env["payload"]
            if t == "prompt.selected":
                try: api("POST", f"/agent/prompts/{p['promptId']}/outcome", json={"selectionId": p["selectionId"], "outcome": decide(p["payload"])})
                except DocaError as e:
                    if e.code != "stale_selection": raise           # user went back / prompt closed: nothing to do
            elif t == "prompt.confirmed": print("confirmed:", p["choiceId"], p["outcome"]["summary"], p.get("execution"))
            elif t == "device.vars":      print("vars changed on", p["deviceId"], p["changed"], p["vars"])
            elif t == "device.message":   print("message:", p["type"], p["payload"])
            elif t == "sensor.samples":   print(len(p["samples"]), "samples from", p["deviceId"])
    except (requests.RequestException, requests.HTTPError) as e:
        time.sleep(2)                                                 # add exponential backoff in production
```

Sensors and artifacts from the same session:

```python
# Ask for 20 s of heart rate; the profile's sensors.allow decides what is granted.
req = api("POST", "/agent/sensors/requests", json={
    "deviceId": watch["id"], "reason": "HRV check before a risky restart",
    "sensors": [{"id": "heartRate", "rateHz": 1, "durationSec": 20}]})
print(req["request"]["id"], "rejected:", req["rejected"])
time.sleep(25)
samples = api("GET", f"/agent/sensors/requests/{req['request']['id']}?limit=200")["samples"]

# Ship a pure JS function the watch can run on its own samples (only if it declared exec: ["js"]).
art = api("POST", "/agent/artifacts", json={
    "name": "rmssd", "runtime": "js", "entry": "rmssd", "purpose": "HRV from RR intervals, on-device",
    "content": "export function rmssd(rr){let s=0;for(let i=1;i<rr.length;i++){const d=rr[i]-rr[i-1];s+=d*d}return Math.sqrt(s/Math.max(1,rr.length-1))}"})["artifact"]
report = api("POST", f"/agent/artifacts/{art['id']}/deliver", json={"targets": [watch["id"]], "inline": True, "message": "run on each heartRate batch"})["report"]

# One-way news
api("POST", "/agent/alerts", json={"title": "Backup finished", "priority": "normal", "targets": [watch["id"]],
                                   "body": [{"type": "text", "text": "4.2 GB in 3 m 12 s"}]})
```

---

## Testing your client without hardware

- `npm run client:demo` on the host runs the whole protocol once against a live
  server with a scripted watch, phone and agent; read `clients/reference/demo.sh`
  for the exact calls, and `clients/reference/watch.sh` for a shell client that
  covers every device-side endpoint.
- Point your app at that server and pair it as a second device; the agent
  simulator (`node clients/reference/agent-sim.js`) will answer your free-form
  selections without any LLM.
- Import [`openapi.json`](openapi.json) into Postman/Insomnia/Bruno for
  exploratory calls; every operation carries `x-scope` so you know which preset
  you need.

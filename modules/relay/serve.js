'use strict';

/**
 * The model relay's requests (relay/index.js): who is asking (a computer's relay token on the bridge listener, or a
 * paired device's own token at /api/v1/relay — relay/v1.js), which model, whether their
 * budget and level allow it, and the request sent on through the hub's own provider — its body as the caller wrote it
 * (tools, temperature, everything), with the model the relay chose, and its answer passed back as the provider gave
 * it: a stream frame by frame, or one JSON body. What is refused is refused in OpenAI's own error shape, so an SDK
 * inside the computer says it in its own words. The provider's key is added by transport.post and appears nowhere in
 * what goes back (scrubbed, should a provider ever echo it).
 *
 * Every request is a usage row tagged with where it came from — `relay:computer:<id>` or `relay:device:<id>` — for the
 * caller's person (never a word of the prompt), which the Usage page groups by and Chronicle lists (source `relay`);
 * and the provider's own count of it is held against what the request explains (leak.js).
 */
const MAX_BODY = 32 * 1024 * 1024;

function fail(res, status, message, code = null, type = 'invalid_request_error') {
  if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message, type, code } }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > MAX_BODY) { reject(Object.assign(new Error('The request is larger than 32 MB.'), { status: 413 })); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

/** A computer's caller, or a refusal: { computer, person, sessionId, via, label }. */
function caller(req) {
  const relay = require('./index'), rc = require('./computer');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('No relay token: send it as the API key (Authorization: Bearer …).'), { status: 401, code: 'invalid_api_key' });
  const c = rc.byToken(token);
  if (!c) throw Object.assign(new Error('This relay token is not one the hub made, or its computer is gone.'), { status: 401, code: 'invalid_api_key' });
  if (!relay.enabled() || !relay.forComputers()) throw Object.assign(new Error('The hub\'s model relay is off for agents\' computers (its owner switches it on in Field → API keys → Model relay).'), { status: 403, code: 'relay_off' });
  if (!c.relayOn) throw Object.assign(new Error(`The model relay is switched off for the computer "${c.name}" (Computers tab, or the computer tool's relay action).`), { status: 403, code: 'relay_off' });
  if (c.archivedAt) throw Object.assign(new Error(`The computer "${c.name}" is put away in the Archive.`), { status: 403, code: 'relay_off' });
  const { personId, sessionId } = rc.ownerOf(c);
  return { computer: c, person: rc.personOf(personId), sessionId, via: `relay:computer:${c.id}`, label: 'this computer' };
}

/** A paired device's caller (its token already checked, `relay:use` held), or a refusal. */
function deviceCaller(device) {
  const relay = require('./index');
  if (!relay.enabled() || !relay.forDevices()) throw Object.assign(new Error('The hub\'s model relay is off for paired devices (its owner switches it on in Field → API keys → Model relay).'), { status: 403, code: 'relay_off' });
  if (!device.relayOn) throw Object.assign(new Error(`The model relay is switched off for the device "${device.name}" (Field → API keys → Model relay).`), { status: 403, code: 'relay_off' });
  return { device, person: require('./computer').personOf(device.userId || null), sessionId: null, via: require('./device').via(device), label: 'this device' };
}

async function models(req, res, who) {
  const list = require('./index').allowedFor(who.person);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ object: 'list', data: list.map(e => ({ id: e.model, object: 'model', owned_by: e.provider, created: 0 })) }));
}

/** Its budget and the harness's daily ceiling, as a turn's start checks them; a money budget needs a priced model. */
async function admit(who, pick) {
  const params = require('../harness/turn/params').params();
  await require('../harness/turn/ceiling').check(params, new Date(), { person: who.person, sessionId: who.sessionId });
  require('../spending').priced({ person: who.person, sessionId: who.sessionId }, { ...params, provider: pick.provider, model: pick.model, fallbackChain: [] });
  return params;
}

async function chat(req, res, who) {
  const relay = require('./index');
  let body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : undefined;   // parsed already under /api/v1
  if (body === undefined) try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'The body is not JSON.'); }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return fail(res, 400, 'messages is required (an array).');
  const list = relay.allowedFor(who.person);
  const pick = relay.resolve(body.model, list);
  if (!pick) {
    return fail(res, 404, list.length ? `The relay offers ${list.map(e => e.model).join(', ')} to ${who.label}; "${body.model}" is not one of them.`
      : `The relay offers no model to ${who.label}: none of the ones it lists is allotted to its person (Settings → Users), or none is chosen (Field → API keys → Model relay).`, 'model_not_found');
  }
  const params = await admit(who, pick);
  const providers = require('../harness/providers');
  const ep = providers.endpoint(pick.provider);
  const stream = body.stream === true;
  const wantUsage = body.stream_options?.include_usage === true;
  const fwd = { ...body, model: pick.model, ...(stream ? { stream_options: { ...(body.stream_options || {}), include_usage: true } } : {}) };
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });   // the caller hung up: the provider's request stops
  const scrub = s => (ep.apiKey && ep.apiKey.length >= 8 ? String(s).split(ep.apiKey).join('') : String(s));
  const meta = { kind: 'relay', sessionId: who.sessionId, agent: who.via, person: who.person };
  await require('../service-life').ensure(ep.baseUrl, { role: 'model' });
  const ended = require('../harness/inflight').start({ kind: 'relay', provider: ep.id, url: ep.baseUrl, model: pick.model, sessionId: who.sessionId, agent: meta.agent });
  try {
    const r = await require('../harness/turn/transport').post(ep, fwd, ctrl.signal, params);
    const record = (u, content) => {
      require('../harness/usage').record({ ...meta, provider: ep.id, model: pick.model, usage: u, body: fwd, reply: { content } });
      require('./leak').check({ via: who.via, person: who.person, provider: ep.id, model: pick.model, body: fwd, content, usage: u });
    };
    if (!(r.headers.get('content-type') || '').includes('event-stream')) {
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch { /* passed on as it came */ }
      record(json?.usage || null, require('./leak').replyText(json));
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
      return res.end(scrub(text));
    }
    res.writeHead(r.status, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', usage = null, content = '';
    const line = l => {
      if (!l.startsWith('data:')) return res.write(`${scrub(l)}\n`);
      const payload = l.slice(5).trim();
      let f = null; try { f = payload && payload !== '[DONE]' ? JSON.parse(payload) : null; } catch { /* not ours to read */ }
      if (!f) return res.write(`${scrub(l)}\n`);
      if (f.usage) usage = f.usage;
      content += require('./leak').deltaText(f);
      if (f.usage && !wantUsage) {   // asked for the ledger's sake, not the caller's: their stream is as they asked for it
        if (!f.choices?.length) return undefined;
        delete f.usage;
        return res.write(`data: ${scrub(JSON.stringify(f))}\n`);
      }
      return res.write(`${scrub(l)}\n`);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      lines.forEach(line);
    }
    if (buf) line(buf);
    record(usage, content);
    res.end();
  } finally { ended(); }
}

async function handle(req, res) {
  const listen = require('../listen');
  const peer = req.socket.remoteAddress;
  if (!listen.isLoopback(peer) && !listen.isPrivate(peer)) { req.socket.destroy(); return; }   // the bridge and this machine only
  const url = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  try {
    const route = req.method === 'GET' && url === '/v1/models' ? models : req.method === 'POST' && url === '/v1/chat/completions' ? chat : null;
    if (!route) return fail(res, 404, `The relay answers GET /v1/models and POST /v1/chat/completions; not ${req.method} ${url}.`, 'not_found');
    await route(req, res, caller(req));
  } catch (e) { refuse(res, e); }
}

function refuse(res, e) {
  const status = Number(e.status) || 500;
  const type = status === 429 ? 'insufficient_quota' : status >= 500 ? 'server_error' : 'invalid_request_error';
  fail(res, status, String(e.message || e), e.code || null, type);
}

/** GET /api/v1/relay/models and POST /api/v1/relay/chat/completions, for a paired device (relay/v1.js). */
async function handleDevice(req, res, route) {
  try { await (route === 'models' ? models : chat)(req, res, deviceCaller(req.device)); }
  catch (e) { refuse(res, e); }
}

module.exports = { handle, handleDevice, deviceCaller };

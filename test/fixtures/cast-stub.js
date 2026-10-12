'use strict';

/**
 * A Cast device for tests (cast-reach.md §8): TLS on its own port with a certificate of its own, Cast v2 framing, the
 * receiver (GET_STATUS, LAUNCH, STOP, SET_VOLUME), the Default Media Receiver's LOAD and DashCast's {url} — and, like a
 * real receiver, it fetches what it is given itself, so a test sees what reached it and from where it was served.
 *
 *   const dev = await castStub.start()     → { port, fetched: [{url, status, bytes, type}], heard: [messages], close() }
 */
const tls = require('tls');
const { encode, reader, NS } = require('../../modules/cast/castv2/wire');

async function start({ fetchContent = true } = {}) {
  const pems = await require('selfsigned').generate([{ name: 'commonName', value: 'cast-stub' }], { days: 1, keySize: 2048 });
  const state = { apps: [], volume: { level: 0.4, muted: false }, fetched: [], heard: [] };
  let n = 0;
  const status = () => ({ applications: state.apps, volume: state.volume });
  const get = async url => {
    if (!fetchContent) return;
    try {
      const r = await fetch(url, { redirect: 'manual' });
      const buf = Buffer.from(await r.arrayBuffer());
      state.fetched.push({ url, status: r.status, bytes: buf.length, type: r.headers.get('content-type'), location: r.headers.get('location'), cookie: r.headers.get('set-cookie') });
    } catch (e) { state.fetched.push({ url, error: e.cause?.code || e.message }); }
  };
  const server = tls.createServer({ key: pems.private, cert: pems.cert }, sock => {
    const send = (src, dst, ns, p) => sock.write(encode(src, dst, ns, p));
    sock.on('error', () => {});
    sock.on('data', reader(async m => {
      state.heard.push(m);
      const d = m.data || {}, reply = (ns, p) => send(m.destination, m.source, ns, { ...p, requestId: d.requestId });
      if (m.namespace === NS.receiver) {
        if (d.type === 'GET_STATUS') reply(NS.receiver, { type: 'RECEIVER_STATUS', status: status() });
        else if (d.type === 'LAUNCH') {
          state.apps = [{ appId: d.appId, displayName: d.appId, sessionId: `s${++n}`, transportId: `t${n}` }];
          reply(NS.receiver, { type: 'RECEIVER_STATUS', status: status() });
        } else if (d.type === 'STOP') { state.apps = []; reply(NS.receiver, { type: 'RECEIVER_STATUS', status: status() }); }
        else if (d.type === 'SET_VOLUME') { Object.assign(state.volume, d.volume || {}); reply(NS.receiver, { type: 'RECEIVER_STATUS', status: status() }); }
      } else if (m.namespace === NS.media && d.type === 'LOAD') {
        await get(d.media?.contentId);
        reply(NS.media, { type: 'MEDIA_STATUS', status: [{ mediaSessionId: 1, playerState: 'PLAYING', media: d.media }] });
      } else if (m.namespace === NS.media && d.type === 'GET_STATUS') {
        reply(NS.media, { type: 'MEDIA_STATUS', status: [] });
      } else if (m.namespace === NS.dashcast && d.url) {
        await get(d.url);   // DashCast answers nothing
      }
    }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, state, get fetched() { return state.fetched; }, get heard() { return state.heard; },
    close: () => new Promise(r => server.close(r)) };
}

module.exports = { start };

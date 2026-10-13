'use strict';

/**
 * A sentence as sound for a speaker (docs/design/cast-reach.md §4): the person's Quick call voice (call-voices.js —
 * their own layer, else the hive's), from the hub's speech service, as MP3 the Default Media Receiver plays. A voice
 * from a hosted service is not used here yet: the hive's own speech service says it instead.
 */
async function speak(text, person = {}) {
  let mine = null;
  try { mine = require('../call-voices').pick('quick', { userId: person.id || null }); } catch { /* the hive's below */ }
  const engines = require('../tts-engines');
  let vs = mine?.engine;
  if (!vs || vs.hosted) vs = engines.hive();
  if (!vs?.ttsUrl) throw Object.assign(new Error('No speech service is set up (Settings → Voice).'), { status: 409 });
  const chosen = await require('../tts-voices').resolve(mine?.voice || '', vs, { host: false }).catch(() => ({ voice: mine?.voice || '' }));
  const sent = engines.body(vs, text, { voice: chosen.voice, speed: mine?.speed || null, format: 'mp3' });
  if (!sent.input) throw Object.assign(new Error('Nothing to say.'), { status: 400 });
  await require('../service-life').ensure(vs.ttsUrl, { wait: true, role: 'speech' });
  const r = await require('../service-life').use(vs.ttsUrl, () => fetch(`${vs.ttsUrl}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent), signal: AbortSignal.timeout(30000) }));
  if (!r.ok) throw Object.assign(new Error(`The speech service answered ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'audio/mpeg' };
}

module.exports = { speak };

/* The face full screen (/face): for a TV, an old tablet or a second monitor. F toggles full screen, and the
   screen is kept awake where the browser allows it. The face spec is faceSpec()'s: this browser's, the screen's or the hive's. */
(async function kiosk() {
  const spec = await faceSpec();
  // The HUD names the product (its private label too), not the palette's source.
  let name = '';
  try { const r = await fetch('/api/branding', { credentials: 'same-origin' }); if (r.ok) name = (await r.json()).product || ''; } catch { /* no name */ }
  const face = faceMount(document.getElementById('face'), { name, ...spec });
  addEventListener('resize', () => face.resize());
  faceFeed(s => face.set(s.state, s.detail));
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'f') return;
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  });
  const awake = () => navigator.wakeLock?.request('screen').catch(() => {});
  awake();
  // "Being looked at", as the panel says it (lib/presence.js): a face on a wall keeps the voice warm for a quick answer
  // (modules/service-life holds the services DOCA started on while a page is open).
  const beat = visible => fetch('/api/presence', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible, page: 'face', solo: true }) }).catch(() => {});
  setInterval(() => { if (document.visibilityState === 'visible') beat(true); }, 30000);
  beat(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', () => { beat(document.visibilityState === 'visible'); if (document.visibilityState === 'visible') awake(); });
}());

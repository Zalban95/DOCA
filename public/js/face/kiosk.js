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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') awake(); });
}());

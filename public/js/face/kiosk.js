/* The face full screen (/face): for a TV, an old tablet or a second monitor. F toggles full screen, and the
   screen is kept awake where the browser allows it. The face spec is faceSpec()'s: this browser's, the screen's or the hive's. */
(async function kiosk() {
  const spec = await faceSpec();
  const face = faceMount(document.getElementById('face'), spec);
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

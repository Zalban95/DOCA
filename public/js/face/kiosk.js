/* The face full screen (/face): for a TV, an old tablet or a second monitor. F toggles full screen, and the
   screen is kept awake where the browser allows it. The face spec is this screen's (localStorage), else the default. */
(function kiosk() {
  let spec = {};
  try { spec = JSON.parse(localStorage.getItem('doca.face.spec') || '{}'); } catch { /* the default */ }
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

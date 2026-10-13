/* A cast screen's session without a cookie (R3i; the owner's yes of 2026-10-13): a Cast receiver may keep no cookie,
   so the view link hands the session in the address's fragment (`#vs=…`, never sent to the hub or written in a log),
   and this script — loaded before any other — sends it with the page's own requests: `X-Cast-View` on fetch, `vs=` on
   a live stream (an EventSource cannot set a header). The hub takes it only for a view session (auth/credentials.js):
   one page, read-only, signed out with Stop. Nothing happens on a page opened any other way. */
(() => {
  if (typeof window === 'undefined') return;
  let vs = null;
  try {
    const m = /(?:^#|&)vs=([A-Za-z0-9_-]{20,200})/.exec(location.hash);
    vs = m ? m[1] : sessionStorage.getItem('doca.vs');
    if (m) sessionStorage.setItem('doca.vs', m[1]);
  } catch { /* no storage: the fragment alone */ }
  if (!vs) return;
  const same = u => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!same(url)) return rawFetch(input, init);
    const headers = new Headers(init.headers || (typeof input !== 'string' && input?.headers) || {});
    headers.set('X-Cast-View', vs);
    return rawFetch(input, { ...init, headers });
  };
  const RawES = window.EventSource;
  if (RawES) window.EventSource = function (url, opts) {
    if (!same(url)) return new RawES(url, opts);
    const u = new URL(url, location.href); u.searchParams.set('vs', vs);
    return new RawES(u.pathname + u.search, opts);
  };
})();

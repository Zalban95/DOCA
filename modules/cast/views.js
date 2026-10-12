'use strict';

/**
 * What a cast screen may read (docs/design/cast-and-devices.md; the owner's yes of 2026-10-12): a view session — a
 * screen made by a view link, a TV or a monitor with no keyboard — shows one page, read-only. It reads only what that
 * page reads (measured by opening each page in a browser and recording its requests, 2026-10-12; test/cast.test.js
 * opens each again under a view session) plus the few calls every page makes to say it is there, and never opens a
 * socket (a console or a terminal): machines are seen as Live's pictures. Everything else is refused as `view_only`.
 */
const COMMON = [
  /^\/api\/(auth\/me|branding|licence|screen|screen\/layout|live\/stream|status)$/,
];
// The calls a page makes to say it is looking (not changes to anything of the person's or the machine's).
const LOOKING = [/^\/api\/presence$/, /^\/api\/workstream\/hold$/, /^\/api\/home\/hold$/, /^\/api\/live\/watch$/];

const VIEWS = {
  // Live's pictures: served pages, VMs and VNC screens by their shots; never a console (a socket) or a VNC test.
  live: { label: 'Live', reads: [/^\/api\/machines(\/rows)?$/, /^\/api\/machines\/shots\/[^/]+$/, /^\/api\/machines\/served\/[^/]+\/shot$/,
    /^\/api\/machines\/vms\/[^/]+\/[^/]+\/shot$/, /^\/api\/machines\/vnc\/[^/]+\/shot$/, /^\/api\/computers\/[^/]+\/screen$/, /^\/api\/models\/servers$/] },
  workstream: { label: 'the Workstream', reads: [/^\/api\/workstream$/, /^\/api\/machines\/rows$/] },
  ambient: { label: 'Ambient', reads: [/^\/api\/ambient(\/place)?$/, /^\/api\/face\/stream$/] },
  home: { label: 'Home', reads: [/^\/api\/home$/, /^\/api\/home\/camera\/[^/]+$/] },
  computers: { label: 'the agents\' computers', reads: [/^\/api\/computers$/, /^\/api\/computers\/[^/]+\/screen$/] },
  chronicle: { label: 'Chronicle', reads: [/^\/api\/chronicle(\/story)?$/] },
  face: { label: 'the face', reads: [/^\/api\/face\/stream$/] },
};

const pageOf = cap => (Array.isArray(cap) ? cap : []).map(c => /^view:([a-z]+)$/.exec(String(c))?.[1]).find(Boolean) || null;

/** Whether a view session showing `page` may make this request (`p` lower-cased, no trailing slash). */
function allows(page, method, p) {
  const v = VIEWS[page];
  if (!v) return false;
  if (!p.startsWith('/api/')) return method === 'GET';   // the page, its scripts and styles
  if (method === 'GET') return COMMON.some(re => re.test(p)) || v.reads.some(re => re.test(p));
  return method === 'POST' && LOOKING.some(re => re.test(p));
}

module.exports = { VIEWS, COMMON, LOOKING, pageOf, allows };

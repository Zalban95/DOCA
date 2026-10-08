'use strict';

/**
 * CalDAV (RFC 4791) and CardDAV (RFC 6352), as much as reading calendars and contacts and adding an event needs, over
 * fetch with HTTP Basic and an app password — no dependency. Discovery goes the standard way: the principal
 * (current-user-principal, trying /.well-known/ first), its calendar-home-set or addressbook-home-set, then the
 * collections in it. Answers are WebDAV multistatus XML, read here with namespace prefixes dropped — every server
 * picks its own (d:, D:, none) — which is enough for the few properties asked for.
 *
 * The password goes only to the server the person named, or a host of the same domain the server itself points to
 * (iCloud answers caldav.icloud.com with p42-caldav.icloud.com — a host under caldav.icloud.com's parent, icloud.com):
 * never to an address elsewhere.
 */
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** The domain a server's own other hosts share: caldav.icloud.com → icloud.com; nothing for a two-label host. */
const parentOf = host => { const p = host.split('.').slice(1); return p.length >= 2 ? p.join('.') : null; };
const entity = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const xmlText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Multistatus → [{ href, props: { name: inner xml } }] for the propstats that answered 200. */
function multistatus(xml) {
  const flat = String(xml).replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1').replace(/\sxmlns(:[\w-]+)?="[^"]*"/g, '');
  const out = [];
  for (const [, body] of flat.matchAll(/<response\b[^>]*>([\s\S]*?)<\/response>/g)) {
    const href = entity((/<href>([\s\S]*?)<\/href>/.exec(body) || [])[1] || '').trim();
    const props = {};
    for (const [, ps] of body.matchAll(/<propstat>([\s\S]*?)<\/propstat>/g)) {
      if (!/<status>[^<]*\b200\b/.test(ps)) continue;
      const prop = (/<prop>([\s\S]*)<\/prop>/.exec(ps) || [])[1] || '';
      for (const [, name, inner] of prop.matchAll(/<([\w-]+)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g)) props[name] = inner ?? '';
    }
    out.push({ href, props });
  }
  return out;
}

const hrefIn = s => entity((/<href>([\s\S]*?)<\/href>/.exec(String(s || '')) || [])[1] || '').trim() || null;

function client({ base, user, password, timeoutMs = 20000 }) {
  let root;
  try { root = new URL(base); } catch { throw bad('The server address is an https:// address.'); }
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const parent = parentOf(root.hostname);
  const allowed = u => u.host === root.host || (u.protocol === root.protocol && !!parent && u.hostname.endsWith(`.${parent}`));

  async function request(method, href, { body, depth, headers = {}, hops = 0 } = {}) {
    const u = new URL(href, root);
    if (!allowed(u)) throw bad(`The server pointed to ${u.host}, which is not ${root.host}'s: the password is not sent there.`, 502);
    let r;
    try {
      r = await fetch(u, { method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), body,
        headers: { Authorization: auth, 'User-Agent': 'DOCA', ...(depth !== undefined ? { Depth: String(depth) } : {}), ...(body && !headers['Content-Type'] ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}), ...headers } });
    } catch (e) { throw bad(`${u.host} could not be reached (${e.cause?.code || e.name}).`, 502); }
    if ([301, 302, 307, 308].includes(r.status) && r.headers.get('location')) {
      if (hops >= 5) throw bad(`${u.host} redirected too many times.`, 502);
      return request(method, new URL(r.headers.get('location'), u).toString(), { body, depth, headers, hops: hops + 1 });
    }
    if (r.status === 401) throw bad(`${u.host} refused the user name or app password.`, 401);
    return { status: r.status, url: u.toString(), text: await r.text() };
  }

  const PROP = names => `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${names}</d:prop></d:propfind>`;
  async function propfind(href, names, depth = 0) {
    const r = await request('PROPFIND', href, { body: PROP(names), depth });
    if (r.status !== 207) throw bad(`${new URL(r.url).host} answered ${r.status} to PROPFIND.`, 502);
    return { url: r.url, rows: multistatus(r.text) };
  }

  /** The home of calendars (`kind` caldav) or address books (carddav). */
  async function home(kind) {
    let principal = null;
    for (const start of [`/.well-known/${kind}`, root.pathname || '/']) {
      try {
        const { url, rows } = await propfind(start, '<d:current-user-principal/>');
        principal = hrefIn(rows.find(x => x.props['current-user-principal'])?.props['current-user-principal']);
        if (principal) { principal = new URL(principal, url).toString(); break; }
      } catch (e) { if (e.status === 401) throw e; }
    }
    if (!principal) throw bad(`${root.host} did not say where this account's ${kind === 'caldav' ? 'calendars' : 'contacts'} are (no current-user-principal).`, 502);
    const prop = kind === 'caldav' ? 'calendar-home-set' : 'addressbook-home-set';
    const { url, rows } = await propfind(principal, kind === 'caldav' ? '<c:calendar-home-set/>' : '<a:addressbook-home-set/>');
    const h = hrefIn(rows.find(x => x.props[prop])?.props[prop]);
    if (!h) throw bad(`${root.host} gave no ${prop}.`, 502);
    return new URL(h, url).toString();
  }

  /** The collections in a home: calendars (with VEVENT) or address books, as { href, name }. */
  async function collections(kind) {
    const h = await home(kind);
    const { url, rows } = await propfind(h, '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>', 1);
    const want = kind === 'caldav' ? /<calendar\b/ : /<addressbook\b/;
    return rows.filter(x => want.test(x.props.resourcetype || '') && (kind !== 'caldav' || !x.props['supported-calendar-component-set'] || /VEVENT/.test(x.props['supported-calendar-component-set'])))
      .map(x => ({ href: new URL(x.href, url).toString(), name: entity(x.props.displayname || '').trim() || decodeURIComponent(x.href.replace(/\/$/, '').split('/').pop()) }));
  }

  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /** The iCalendar texts of a calendar's events touching [from, to). */
  async function events(href, from, to) {
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop>`
      + `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const r = await request('REPORT', href, { body, depth: 1 });
    if (r.status !== 207) throw bad(`${new URL(r.url).host} answered ${r.status} to the calendar query.`, 502);
    return multistatus(r.text).map(x => entity(x.props['calendar-data'] || '')).filter(t => /BEGIN:VCALENDAR/.test(t));
  }

  /** The vCards of an address book. */
  async function cards(href) {
    const body = '<?xml version="1.0" encoding="utf-8"?><a:addressbook-query xmlns:d="DAV:" xmlns:a="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><a:address-data/></d:prop>'
      + '<a:filter test="anyof"><a:prop-filter name="FN"/><a:prop-filter name="EMAIL"/></a:filter></a:addressbook-query>';
    const r = await request('REPORT', href, { body, depth: 1 });
    if (r.status !== 207) throw bad(`${new URL(r.url).host} answered ${r.status} to the contacts query.`, 502);
    return multistatus(r.text).map(x => entity(x.props['address-data'] || '')).filter(t => /BEGIN:VCARD/i.test(t));
  }

  /** A new event, written only if nothing has its name (If-None-Match). */
  async function put(collection, name, ics) {
    const r = await request('PUT', new URL(name, collection.endsWith('/') ? collection : `${collection}/`).toString(),
      { body: ics, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' } });
    if (![200, 201, 204].includes(r.status)) throw bad(`${new URL(r.url).host} answered ${r.status} when the event was written.`, 502);
    return r.url;
  }

  return { collections, events, cards, put, request };
}

module.exports = { client, multistatus, xmlText };

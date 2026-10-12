'use strict';

/**
 * A stand-in for Google (OAuth, Calendar v3, Gmail v1) and Microsoft (OAuth, Graph calendar and mail), enough for the
 * everyday accounts (modules/accounts) to be tested without the network. One server: `/oauth/<provider>/…` signs in
 * (PKCE checked), `/g/…` is Google's API, `/ms/…` Graph's. Each access token belongs to one mailbox, so a call with
 * another person's token sees another mailbox — which is what the isolation tests look for.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function start() {
  const S = { codes: new Map(), tokens: new Map(), boxes: new Map(), calls: [], seq: 0, history: 100 };
  const box = email => {
    if (!S.boxes.has(email)) S.boxes.set(email, { events: new Map(), mail: new Map(), labels: [{ id: 'INBOX', name: 'INBOX' }], sent: [], categories: new Map() });
    return S.boxes.get(email);
  };
  const id = p => `${p}${++S.seq}`;

  /** A mail arriving in a mailbox (Google's shape is kept; Graph's is made from it). */
  S.deliver = (email, { from, subject, body = '', headers = {}, threadId = null, labels = ['INBOX', 'UNREAD'] }) => {
    const m = { id: id('m'), threadId: threadId || id('t'), from, subject, body, headers, labels: [...labels], historyId: ++S.history, date: Date.now() };
    box(email).mail.set(m.id, m);
    return m;
  };
  /** What the person's browser does at the authorize page: a code for this mailbox. */
  S.authorize = (url, email) => {
    const u = new URL(url), code = crypto.randomBytes(6).toString('hex');
    S.codes.set(code, { challenge: u.searchParams.get('code_challenge'), email, scope: u.searchParams.get('scope'), provider: u.pathname.split('/')[2] });
    return { state: u.searchParams.get('state'), code, scope: u.searchParams.get('scope') };
  };
  S.box = box;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), p = u.pathname;
      const json = (j, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(s === 204 ? '' : JSON.stringify(j)); };
      const body = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
      S.calls.push({ method: req.method, path: p, query: u.search, auth: req.headers.authorization || null, body });
      // ── OAuth ──
      if (/^\/oauth\/(google|microsoft)\/token$/.test(p)) {
        const f = Object.fromEntries(new URLSearchParams(raw));
        if (f.client_id !== 'cid' || f.client_secret !== 'csecret') return json({ error: 'invalid_client' }, 401);
        if (f.grant_type === 'authorization_code') {
          const c = S.codes.get(f.code);
          if (!c || b64url(crypto.createHash('sha256').update(f.code_verifier || '').digest()) !== c.challenge) return json({ error: 'invalid_grant' }, 400);
          S.codes.delete(f.code);
          const at = `tok-${id('a')}`;
          S.tokens.set(at, c.email);
          return json({ access_token: at, refresh_token: `rt-${c.email}`, expires_in: 3600, scope: c.scope });
        }
        if (f.grant_type === 'refresh_token') { const at = `tok-${id('a')}`; S.tokens.set(at, f.refresh_token.slice(3)); return json({ access_token: at, expires_in: 3600 }); }
        return json({ error: 'unsupported_grant_type' }, 400);
      }
      const email = S.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      if (/^\/oauth\/(google|microsoft)\/whoami$/.test(p)) return email ? json({ email, userPrincipalName: email, mail: email }) : json({ error: 'no' }, 401);
      if (!email) return json({ error: { message: 'Invalid credentials' } }, 401);
      const B = box(email);
      // ── Google Calendar ──
      let m = /^\/g\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/.exec(p);
      if (m) {
        const ev = m[1] && B.events.get(decodeURIComponent(m[1]));
        if (m[1] && !ev) return json({ error: { message: 'Not Found' } }, 404);
        if (req.method === 'GET' && ev) return json(ev);
        if (req.method === 'GET') {
          const from = Date.parse(u.searchParams.get('timeMin') || 0), to = Date.parse(u.searchParams.get('timeMax') || '2999-01-01'), q = (u.searchParams.get('q') || '').toLowerCase();
          return json({ items: [...B.events.values()].filter(e => Date.parse(e.start.dateTime || e.start.date) < to && Date.parse(e.end.dateTime || e.end.date) > from && (!q || e.summary.toLowerCase().includes(q))) });
        }
        if (req.method === 'POST') { const e = { id: id('e'), status: 'confirmed', htmlLink: 'https://calendar.example/e', ...body }; B.events.set(e.id, e); return json(e); }
        if (req.method === 'PATCH') { Object.assign(ev, body); return json(ev); }
        if (req.method === 'DELETE') { B.events.delete(ev.id); return json({}, 204); }
      }
      // ── Gmail ──
      const g = p.replace(/^\/g\/gmail\/v1\/users\/me/, '');
      if (g !== p) {
        const gmsg = (x, fmt) => ({ id: x.id, threadId: x.threadId, labelIds: x.labels, snippet: x.body.slice(0, 80), internalDate: String(x.date), historyId: String(x.historyId),
          payload: { mimeType: 'text/plain', headers: [['From', x.from], ['To', email], ['Subject', x.subject], ...Object.entries(x.headers)].map(([name, value]) => ({ name, value })),
            ...(fmt === 'full' ? { body: { data: Buffer.from(x.body).toString('base64url') } } : {}) } });
        if (g === '/profile') return json({ emailAddress: email, historyId: String(S.history) });
        if (g === '/messages' && req.method === 'GET') {
          const q = u.searchParams.get('q') || '';
          const fromQ = /from:(\S+)/.exec(q)?.[1];
          return json({ messages: [...B.mail.values()].filter(x => (!/in:inbox/.test(q) || x.labels.includes('INBOX')) && (!/is:unread/.test(q) || x.labels.includes('UNREAD'))
            && (!fromQ || x.from.includes(fromQ))).reverse().map(x => ({ id: x.id, threadId: x.threadId })) });
        }
        if (g === '/messages/send') { B.sent.push(body); const x = { id: id('m'), threadId: body.threadId || id('t') }; return json(x); }
        if (g === '/history') {
          const since = Number(u.searchParams.get('startHistoryId'));
          if (since < 50) return json({ error: { message: 'Requested entity was not found.' } }, 404);
          const added = [...B.mail.values()].filter(x => x.historyId > since);
          return json({ history: added.map(x => ({ id: String(x.historyId), messagesAdded: [{ message: { id: x.id, labelIds: x.labels } }] })), historyId: String(S.history) });
        }
        if (g === '/labels' && req.method === 'GET') return json({ labels: B.labels });
        if (g === '/labels' && req.method === 'POST') { const l = { id: id('Label_'), name: body.name }; B.labels.push(l); return json(l); }
        let mm = /^\/messages\/([^/]+)(\/modify)?$/.exec(g);
        if (mm) {
          const x = B.mail.get(decodeURIComponent(mm[1]));
          if (!x) return json({ error: { message: 'Not Found' } }, 404);
          if (mm[2]) { x.labels = [...new Set([...x.labels, ...(body.addLabelIds || [])])].filter(l => !(body.removeLabelIds || []).includes(l)); return json({ id: x.id, labelIds: x.labels }); }
          return json(gmsg(x, u.searchParams.get('format')));
        }
        mm = /^\/threads\/([^/]+)$/.exec(g);
        if (mm) return json({ id: mm[1], messages: [...B.mail.values()].filter(x => x.threadId === mm[1]).map(x => gmsg(x, 'metadata')) });
      }
      // ── Microsoft Graph ──
      const ms = p.replace(/^\/ms\/v1\.0\/me/, '');
      if (ms !== p) {
        const gev = e => e;
        if (ms === '/calendarView') {
          const from = Date.parse(`${u.searchParams.get('startDateTime')}`), to = Date.parse(`${u.searchParams.get('endDateTime')}`);
          return json({ value: [...B.events.values()].filter(e => Date.parse(`${e.start.dateTime}Z`) < to && Date.parse(`${e.end.dateTime}Z`) > from).map(gev) });
        }
        let mm = /^\/events(?:\/([^/]+))?$/.exec(ms);
        if (mm) {
          const ev = mm[1] && B.events.get(decodeURIComponent(mm[1]));
          if (mm[1] && !ev) return json({ error: { code: 'ErrorItemNotFound', message: 'Not found' } }, 404);
          if (req.method === 'GET') return json(ev);
          if (req.method === 'POST') { const e = { id: id('E'), webLink: 'https://outlook.example/e', ...body }; B.events.set(e.id, e); return json(e, 201); }
          if (req.method === 'PATCH') { Object.assign(ev, body); return json(ev); }
          if (req.method === 'DELETE') { B.events.delete(ev.id); return json({}, 204); }
        }
        const gm = x => ({ id: x.id, conversationId: x.threadId, from: { emailAddress: { address: x.from.replace(/.*<|>.*/g, ''), name: x.from.replace(/\s*<.*$/, '') } },
          toRecipients: [{ emailAddress: { address: email } }], subject: x.subject, bodyPreview: x.body.slice(0, 80), receivedDateTime: new Date(x.date).toISOString(),
          isRead: !x.labels.includes('UNREAD'), categories: B.categories.get(x.id) || [], internetMessageId: `<${x.id}@stub>`,
          internetMessageHeaders: Object.entries(x.headers).map(([name, value]) => ({ name, value })), body: { contentType: 'text', content: x.body } });
        if (ms === '/mailFolders/inbox/messages/delta') {
          const since = Number(u.searchParams.get('since') || 0);
          return json({ value: [...B.mail.values()].filter(x => x.labels.includes('INBOX') && x.historyId > since).map(gm), '@odata.deltaLink': `${u.origin === 'http://x' ? '' : ''}${req.headers.host ? `http://${req.headers.host}` : ''}/ms/v1.0/me/mailFolders/inbox/messages/delta?since=${S.history}` });
        }
        if (ms === '/sendMail') { B.sent.push(body); return json({}, 202); }
        if (ms === '/messages' || ms === '/mailFolders/inbox/messages') {
          const conv = /conversationId eq '([^']+)'/.exec(u.searchParams.get('$filter') || '')?.[1];
          return json({ value: [...B.mail.values()].filter(x => (!conv || x.threadId === conv) && (ms === '/messages' || x.labels.includes('INBOX'))).map(gm) });
        }
        mm = /^\/messages\/([^/]+)(\/(move|reply))?$/.exec(ms);
        if (mm) {
          const x = B.mail.get(decodeURIComponent(mm[1]));
          if (!x) return json({ error: { message: 'Not found' } }, 404);
          if (mm[3] === 'reply') { B.sent.push({ reply: x.id, ...body }); return json({}, 202); }
          if (mm[3] === 'move') {
            B.mail.delete(x.id);
            const moved = { ...x, id: id('M'), labels: body.destinationId === 'inbox' ? [...x.labels.filter(l => l !== 'ARCHIVE'), 'INBOX'] : [...x.labels.filter(l => l !== 'INBOX'), 'ARCHIVE'] };
            B.mail.set(moved.id, moved);
            if (B.categories.has(x.id)) B.categories.set(moved.id, B.categories.get(x.id));
            return json(gm(moved), 201);
          }
          if (req.method === 'PATCH') { if (body.categories) B.categories.set(x.id, body.categories); return json(gm(x)); }
          return json(gm(x));
        }
      }
      return json({ error: { message: `stub: no ${req.method} ${p}` } }, 404);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { S.base = `http://127.0.0.1:${server.address().port}`; S.close = () => new Promise(c => server.close(c)); r(S); }));
}

module.exports = { start };

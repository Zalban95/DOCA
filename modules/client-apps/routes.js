'use strict';

/**
 * DOCA's apps on the hub (index.js): the panel lists, uploads and builds them (Settings → DOCA apps); a device asks
 * what the newest is and downloads it.
 *
 *   GET  /api/clients/apps                       what is kept, where each repo is, whether a signing key is held (read)
 *   GET  /api/clients/apps/:app/apk              the APK, to download (read)
 *   POST /api/clients/apps/:app                  upload an APK as the latest (host)
 *   POST /api/clients/apps/:app/repo             where its source is ({repo}) (host)
 *   POST /api/clients/apps/:app/build            build it here and keep it ({pull}); SSE (host)
 *   POST /api/clients/apps/signing               the signing keystore (raw body; ?alias, storePassword, keyPassword) (host)
 *   POST /api/clients/apps/:app/link             a download link that needs no sign-in, for 10 minutes (host) — what a
 *                                                phone's browser opens (DocaMobile's apps_open) to save the APK
 *   GET  /api/clients/apps/:app/apk/:token       that link (public: the token is the permission)
 *   GET  /api/v1/clients/android/:app            for a device: versionCode, versionName, sha256, bytes, where (any token)
 *   GET  /api/v1/clients/android/:app/apk        the APK (any token)
 */
const express = require('express');
const apps = require('./index');

const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const raw = express.raw({ type: () => true, limit: '400mb' });
const sendApk = (req, res) => {
  try {
    const m = apps.latest(req.params.app);
    if (!m) return res.status(404).json({ error: 'No build of it is kept yet.' });
    res.type('application/vnd.android.package-archive').attachment(`${req.params.app}-${m.versionName}.apk`).sendFile(apps.apkFile(req.params.app));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

// One-time download links: a random token per link, kept in memory for ten minutes. A browser may ask twice (a HEAD,
// a resumed download), so a link is good for its ten minutes rather than for one request.
const _links = new Map();
const LINK_MS = 10 * 60 * 1000;
function makeLink(app, req) {
  apps.known(app);
  if (!apps.latest(app)) throw Object.assign(new Error('No build of it is kept yet.'), { status: 404 });
  for (const [t, l] of _links) if (l.until < Date.now()) _links.delete(t);
  const token = require('crypto').randomBytes(24).toString('base64url');
  _links.set(token, { app, until: Date.now() + LINK_MS });
  // The address a phone can open: the one the request came in on, unless that is this machine's own loopback (a link
  // made here, for a phone, must not say 127.0.0.1) — then the hub's tailnet name, which its certificate is for.
  let host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (/^(127\.|localhost|\[::1\])/.test(host)) {
    const fqdn = (() => { try { return require('../https-cert').getTailscaleFqdn(); } catch { return null; } })();
    if (fqdn) host = `${fqdn}:${String(host).split(':').pop()}`;
  }
  return { url: `${req.protocol === 'http' && !req.secure ? 'http' : 'https'}://${host}/api/clients/apps/${app}/apk/${token}`, path: `/api/clients/apps/${app}/apk/${token}`, expiresAt: new Date(Date.now() + LINK_MS).toISOString() };
}

function mount(app) {
  app.post('/api/clients/apps/:app/link', express.json(), h(req => makeLink(req.params.app, req)));
  app.get('/api/clients/apps/:app/apk/:token', (req, res) => {
    const l = _links.get(req.params.token);
    if (!l || l.app !== req.params.app || l.until < Date.now()) return res.status(404).json({ error: 'This link has expired or never existed.' });
    sendApk(req, res);
  });
  app.get('/api/clients/apps', h(() => apps.settings()));
  app.get('/api/clients/apps/:app/apk', sendApk);
  app.post('/api/clients/apps/signing', raw, h(req => apps.setSigning(req.body, { alias: req.query.alias || undefined, storePassword: req.query.storePassword || undefined, keyPassword: req.query.keyPassword || undefined })));
  app.post('/api/clients/apps/:app/repo', express.json(), h(req => apps.setRepo(req.params.app, req.body?.repo)));
  app.post('/api/clients/apps/:app/build', express.json(), async (req, res) => {
    require('../utils').sseHeaders(res);
    const say = status => { try { res.write(`data: ${JSON.stringify({ status })}\n\n`); } catch { /* gone */ } };
    try { const meta = await require('./build').build(req.params.app, { pull: req.body?.pull === true }, say); res.write(`data: ${JSON.stringify({ done: true, ok: true, meta })}\n\n`); }
    catch (e) { res.write(`data: ${JSON.stringify({ done: true, ok: false, status: `✗ ${e.message}\n` })}\n\n`); }
    res.end();
  });
  app.post('/api/clients/apps/:app', raw, h(req => apps.keep(req.params.app, req.body, { from: 'upload', given: req.query, force: req.query.force === '1' })));
}

function mountDevice(router) {
  router.get('/clients/android/:app', (req, res) => {
    try {
      const m = apps.latest(req.params.app);
      if (!m) return res.status(404).json({ error: { code: 'not_found', message: 'No build of it is kept on this hub.' } });
      res.json({ app: m.app, package: m.package, versionCode: m.versionCode, versionName: m.versionName, sha256: m.sha256, bytes: m.bytes, at: m.at, url: `/api/v1/clients/android/${m.app}/apk` });
    } catch (e) { res.status(e.status || 500).json({ error: { code: 'not_found', message: e.message } }); }
  });
  router.get('/clients/android/:app/apk', sendApk);
}

module.exports = { mount, mountDevice };

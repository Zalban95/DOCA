'use strict';

/**
 * The one door every dashboard request walks through (docs/design/auth.md §3).
 *
 *   public path? ─► serve
 *   no users yet? ─► only setup (the login page shows the form)
 *   no session ─► 401 for the API, the login page for a browser
 *   route's right (rights.js, unknown = denied) not held ─► 403
 *   host/users/org and no sign-in for 12 h ─► 401 step_up_required
 *   changes something and did not come from this panel's page ─► 403
 *   ─► handler, with req.auth = { user, orgId, role, session }
 *
 * /api/v1 is mounted before this and keeps its bearer tokens.
 */
const credentials = require('./credentials');
const rights      = require('./rights');
const authStore   = require('./store');

/** Static files the login page needs before anyone is signed in. */
const PUBLIC_FILES = /^\/(login(\.html)?|favicon\.svg|css\/[\w.-]+\.css|js\/login\.js)$/;

const isApi = p => p.startsWith('/api/');
const wantsPage = req => req.method === 'GET' && !isApi(req.path);

function deny(req, res, status, code, error) {
  if (wantsPage(req) && status === 401) {
    const next = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(302, `/login?next=${next}`);
  }
  return res.status(status).json({ error, code });
}

/**
 * Came from this panel's own page. Both headers are set by the browser and
 * neither can be set by page script; the agent's `http_fetch` sets neither.
 * (Was server.js requireBrowser; now it guards every change, not two.)
 */
function sameOrigin(req) {
  const site = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (site === 'same-origin' || site === 'none') return true;
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    try { return new URL(origin).host === req.get('host'); } catch { return false; }
  }
  return false;
}

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function gate(req, res, next) {
  const p = req.path;
  if (PUBLIC_FILES.test(p)) return next();

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const right = isApi(p) ? rights.rightFor(method, p) : 'read';   // the app's own pages and scripts: signed in

  if (right === 'public') return next();

  if (authStore.userCount() === 0)
    return deny(req, res, 401, 'setup_required', 'No account exists yet. Open the panel to set up its owner.');

  const who = credentials.resolve(req);
  if (!who) return deny(req, res, 401, 'unauthenticated', 'Sign in to use the panel.');
  req.auth = who;

  if (who.user.mustChangePassword && !/^\/api\/auth\/(me|password|logout)$/.test(p) && isApi(p))
    return deny(req, res, 403, 'password_change_required', 'Choose a new password before anything else.');

  if (right === null) {
    authStore.audit({ orgId: who.orgId, actorId: who.user.id, action: 'denied', detail: `${method} ${p} (no rule)` });
    return deny(req, res, 403, 'no_rule', 'This route has no access rule, so it is refused. That is a bug in the panel, not in your account.');
  }
  if (right !== 'signed' && !rights.can(who.role, right)) {
    authStore.audit({ orgId: who.orgId, actorId: who.user.id, action: 'denied', detail: `${method} ${p} (needs ${right})` });
    return deny(req, res, 403, 'forbidden', `Your role (${who.role}) cannot do this; it needs the "${right}" right.`);
  }
  if (rights.STEP_UP.has(right) && !credentials.steppedUp(who.session))
    return deny(req, res, 401, 'step_up_required', 'Confirm your password to continue — it has been a while since you signed in.');

  if (CHANGES.has(method)) {
    if (!sameOrigin(req))
      return res.status(403).json({ code: 'browser_only',
        error: 'This route applies a change and expects a click in the dashboard. Open the panel in a browser and do it there.' });
    // Every change, attributable. The body is not logged: it can hold passwords and keys.
    res.on('finish', () => authStore.audit({ orgId: who.orgId, actorId: who.user.id, action: `${method} ${p}`, status: res.statusCode }));
  }
  next();
}

/**
 * The same decision for a WebSocket upgrade, which never reaches Express.
 * @returns {object|null} the person, or null to refuse the upgrade
 */
function upgradeAllowed(req, right) {
  if (authStore.userCount() === 0) return null;
  const who = credentials.resolve(req);
  if (!who || !rights.can(who.role, right)) return null;
  if (rights.STEP_UP.has(right) && !credentials.steppedUp(who.session)) return null;
  // A socket opened from another site would carry the cookie; SameSite=Strict
  // stops that for a browser, and the Origin check stops the rest.
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return null; } catch { return null; } }
  return who;
}

module.exports = { gate, upgradeAllowed, sameOrigin, PUBLIC_FILES };

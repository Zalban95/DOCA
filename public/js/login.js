/* ═══════════════════════════════════════════════════════
   The login page: set up the owner, sign in, or replace a one-time password.
   Stands alone — none of the app's scripts load before someone is signed in.
   ═══════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

/** Where to go after signing in: a path on this panel, never another site. */
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function say(text, kind = '') {
  const el = $('login-status');
  el.textContent = text;
  el.className = `status-line ${kind}`;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || r.statusText), { code: d.code });
  return d;
}

function show(which) {
  for (const id of ['setup-card', 'login-card', 'change-card']) $(id).hidden = id !== which;
  $(which).querySelector('input')?.focus();
}

async function start() {
  try {
    const b = await fetch('/api/branding').then(r => r.json());
    for (const el of document.querySelectorAll('[data-brand]')) el.textContent = b[el.dataset.brand] || el.textContent;
  } catch {}
  let s;
  try { s = await fetch('/api/auth/state').then(r => r.json()); }
  catch (e) { return say(`Cannot reach the panel: ${e.message}`, 'err'); }
  if (s.needsSetup) {
    // At the machine itself no code is asked for; from anywhere else it is.
    $('setup-code-field').hidden = !s.codeNeeded;
    $('setup-code').required = s.codeNeeded;
    $('setup-where').textContent = s.codeNeeded
      ? 'The setup code is in the server log — or run ./run.sh setup-code on the host.'
      : 'You are at the machine itself, so no setup code is needed.';
    return show('setup-card');
  }
  if (s.signedIn && s.user.mustChangePassword) return show('change-card');
  if (s.signedIn) return location.replace(nextUrl());
  $('login-insecure').hidden = s.secure;
  show('login-card');
}

$('setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('setup-password').value !== $('setup-password2').value) return say('The two passwords differ.', 'err');
  say('Creating the owner…');
  try {
    await post('/api/auth/setup', {
      code: $('setup-code').value.trim(), name: $('setup-name').value,
      email: $('setup-email').value, password: $('setup-password').value,
    });
    location.replace(nextUrl());
  } catch (err) { say(err.message, 'err'); }
});

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  say('Signing in…');
  try {
    const r = await post('/api/auth/login', { email: $('login-email').value, password: $('login-password').value });
    if (r.user.mustChangePassword) { say(''); $('change-current').value = $('login-password').value; return show('change-card'); }
    location.replace(nextUrl());
  } catch (err) {
    $('login-password').value = '';
    say(err.message, 'err');
  }
});

$('change-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await post('/api/auth/password', { current: $('change-current').value, password: $('change-password').value });
    location.replace(nextUrl());
  } catch (err) { say(err.message, 'err'); }
});

start();

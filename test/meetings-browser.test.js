'use strict';

/**
 * Meetings in real browsers: two people, each in a headless Chromium of their own with Chromium's fake camera and
 * microphone (--use-fake-device-for-media-stream) and its fake picker (--use-fake-ui-for-media-stream), meet in one
 * room through the hub — voice and video flow both ways over WebRTC, then one shares a screen and the other sees it
 * on the stage, with the red "you are sharing" bar on the sharer's side. Pictures go to DOCA_SHOTS when it is set.
 * Skipped where no Chrome, Edge or Chromium is found.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const H = require('./helpers');   // first: it points the settings at a temporary folder
const headless = require('../modules/headless');

const exe = headless.findBrowser();
const skip = !exe && 'no browser here';
const SHOTS = process.env.DOCA_SHOTS || null;
const browsers = [];
let alice, bob;

async function browser(who, name) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `doca-meet-${name}-`));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...headless.ALONE,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required',
    // Host candidates as addresses, not mDNS names: a CI runner's multicast is not ours to count on (Windows, 2026-10-10).
    // and loopback offered too, so two browsers on one runner meet whatever its adapters and firewall say.
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection',
    '--disable-gpu', '--window-size=1280,800', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: 'ignore', detached: process.platform !== 'win32' });
  const b = { proc, profile, errors: [] };
  browsers.push(b);
  b.page = await headless.connect(await headless.devtools(profile));
  b.page.on(m => { if (m.method === 'Runtime.exceptionThrown') b.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await b.page.send('Runtime.enable'); await b.page.send('Network.enable'); await b.page.send('Page.enable');
  // A busy machine, on purpose: every signalling POST waits a random 0–150 ms before it leaves, so separate requests
  // overtake each other as they did on a loaded Windows runner. The mesh must keep its own order (meet/mesh.js).
  await b.page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch;
    window.fetch = (u, o) => /\\/api\\/meetings\\/[^/]+\\/signal$/.test(String(u)) ? new Promise(r => setTimeout(r, Math.random() * 150)).then(() => f(u, o)) : f(u, o); })();` });
  const [k, v] = who.cookie.split('=');
  await b.page.send('Network.setCookie', { name: k, value: v, url: H.base });
  b.eval = async (expression, gesture = false) => {
    const r = await b.page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  // A page still loading has not defined the panel's globals yet: that is a no, not a failure.
  // Conditions, never fixed sleeps: a busy runner is slow, not wrong — so every wait is generous and ends the moment it holds.
  b.until = async (expression, ms = 45000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await b.eval(expression).catch(() => false)) return true; await headless.sleep(250); } return false; };
  // What the connections were doing, for the message of a wait that ran out.
  b.why = () => b.eval("JSON.stringify({ me: MEET.me, peers: [...MEET.peers.keys()].map(p => ({ p, ...(MEET.mesh?.describe(p) || {}) })) })").catch(e => String(e));
  b.shot = async file => {
    if (!SHOTS) return;
    await headless.sleep(600);
    const { data } = await b.page.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'));
  };
  return b;
}

function kill(b) {
  try {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(b.proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-b.proc.pid, 'SIGKILL');
  } catch { try { b.proc.kill('SIGKILL'); } catch { /* gone */ } }
}

before(async () => {
  if (skip) return;
  await H.start();
  alice = await H.signIn('member', 'alice.b@test.local');
  bob = await H.signIn('member', 'bob.b@test.local');
  require('../modules/auth/store').updateUser?.(alice.user.id, { name: 'Alice' });
  require('../modules/auth/store').updateUser?.(bob.user.id, { name: 'Bob' });
  process.once('exit', () => browsers.forEach(kill));
});
after(async () => { browsers.forEach(kill); if (!skip) await H.stop(); });

/** Bytes this page received from its one peer, by kind (inbound-rtp). */
const received = kind => `(async () => { const p = [...MEET.peers.keys()][0]; const s = p && await MEET.mesh.stats(p); let n = 0;
  s?.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === '${kind}') n += r.bytesReceived || 0; }); return n; })()`;

test('two people meet: voice and video both ways, then a screen shared and seen', { skip, timeout: 300000 }, async t => {
  const a = await browser(alice, 'alice'), b = await browser(bob, 'bob');
  await a.page.send('Page.navigate', { url: `${H.base}/` });
  assert.ok(await a.until("typeof meetingStart === 'function' && document.readyState === 'complete' && typeof _liveScreen !== 'undefined'"), 'the panel loaded');
  const { id } = await a.eval(`meetingStart({ people: [${JSON.stringify(bob.user.id)}], title: 'Design sync' })`, true);
  assert.match(id, /^m[0-9a-f]{12}$/);
  await b.page.send('Page.navigate', { url: `${H.base}/meet/${id}` });   // the link opens the panel on the room
  assert.ok(await b.until(`MEET.id === '${id}' && MEET.peers.size === 1`), 'Bob joined by the link');
  assert.ok(await a.until('MEET.peers.size === 1'), 'Alice sees Bob');
  assert.ok(await a.until("MEET.peers.size === 1 && [...MEET.peers.keys()].every(p => MEET.mesh.state(p) === 'connected')", 90000), `connected — Alice ${await a.why()} Bob ${await b.why()}`);
  assert.ok(await b.until("MEET.peers.size === 1 && [...MEET.peers.keys()].every(p => MEET.mesh.state(p) === 'connected')", 30000), `connected — Bob ${await b.why()}`);
  assert.ok(await b.until("[...document.querySelectorAll('#meet .meet-tile:not(.meet-me) video')].some(v => v.videoWidth > 0)"), 'Bob sees Alice\'s camera');
  assert.ok(await a.until("[...document.querySelectorAll('#meet .meet-tile:not(.meet-me) video')].some(v => v.videoWidth > 0)"), 'Alice sees Bob\'s camera');
  assert.ok(await a.until(`${received('audio')}.then(n => n > 2000)`), 'Alice hears Bob (audio bytes arrive)');
  assert.ok(await b.until(`${received('audio')}.then(n => n > 2000)`), 'Bob hears Alice');
  await a.shot('1-alice-in-call.png'); await b.shot('2-bob-in-call.png');

  // Alice shares her screen: Bob's stage shows it; Alice has the red bar.
  const shared = await a.eval('meetShareStart().then(() => !!MEET.screen, e => String(e))', true);
  // A headless Chromium on a runner without a screen (macOS asks for screen recording permission) may have no picture
  // to share: said, not failed — on Linux, where Chromium's fake capture always answers, it must work.
  if (shared !== true && process.platform !== 'linux') { t.diagnostic(`screen share not available in this headless browser: ${shared}`); return; }
  assert.equal(shared, true, `getDisplayMedia: ${shared}`);
  assert.ok(await a.until("!!document.querySelector('#meet .meet-red')"), 'the sharer is told, in red');
  assert.ok(await b.until("(document.querySelector('#meet .meet-stage video')?.videoWidth || 0) > 0", 60000), `Bob sees the screen on the stage — ${await b.why()}`);
  assert.match(await b.eval("document.querySelector('#meet .meet-stage-cap').textContent"), /Alice's screen/);
  await a.shot('3-alice-sharing.png'); await b.shot('4-bob-sees-share.png');

  // Bob asks for control: Alice is asked; with no DOCA client lending input, an offer is refused in words.
  await b.eval('meetControlAsk([...MEET.peers.keys()][0])');
  assert.ok(await a.until("document.getElementById('app-confirm-modal')?.classList.contains('open')"), 'Alice is asked');
  assert.match(await a.eval("document.getElementById('app-confirm-message').textContent"), /asks to control your screen/);
  await a.shot('5-alice-asked-for-control.png');
  await a.eval("document.getElementById('app-confirm-ok').click()", true);
  assert.ok(await a.until("!!document.querySelector('#meet .meet-offer')"), 'consent 1: whom, and which machine');
  await a.shot('6-alice-offer-form.png');
  await a.eval("document.querySelector('#meet .meet-offer button[type=submit]').click()", true);
  assert.ok(await a.until("/plain browser/.test(document.getElementById('app-confirm-message')?.textContent || '')"), 'no client lending input: pixels only, said in words');
  await a.eval("document.getElementById('app-confirm-ok').click()", true);

  // Stop sharing, chat, fold, leave.
  await a.eval('meetShareStop()', true);
  assert.ok(await b.until("!document.querySelector('#meet .meet-stage')"), 'the stage goes when the share stops');
  await b.eval("(() => { const f = document.querySelector('#meet .meet-say'); f.querySelector('input').value = 'Thanks!'; return meetSay(f); })()");
  assert.ok(await a.until("MEET.chat.some(l => l.text === 'Thanks!')"), 'chat reaches the room');
  await a.eval('MEET.chatOpen = true; meetDraw()');
  await a.shot('7-alice-chat.png');
  await a.eval('meetFold(true)');
  await a.eval("nav('meetings')");
  assert.ok(await a.until("!!document.querySelector('#tab-meetings .mt-row')"), 'the Meetings page lists it');
  await a.shot('8-meetings-page-folded-call.png');
  await b.eval('meetLeave()');
  assert.ok(await a.until('MEET.peers.size === 0'), 'Bob left');
  assert.deepEqual([...a.errors, ...b.errors], [], 'no page error');
});

/**
 * The phone app's half, played by the page itself: a window.DocaDevice that answers as DocaMobile does (the contract in
 * docs/api/fixtures/doca-device.json) — told when a meeting opens and closes, and sharing "its screen" through a
 * MessagePort of JPEG frames because its web view has no getDisplayMedia. The other person sees it on the stage, the
 * share carries the phone's own size (what control is scaled to), and the app ending it, or its notification's Leave,
 * reach the room.
 */
const FAKE_APP = `(() => {
  navigator.mediaDevices.getDisplayMedia = undefined;   // Android's WebView has none
  const calls = window.__app = { meeting: [], share: 0, stop: 0 };
  let timer = null, port = null;
  window.DocaDevice = {
    meeting: j => { calls.meeting.push(JSON.parse(j)); return JSON.stringify({ service: true }); },
    meetAudio: r => JSON.stringify({ route: r || 'speaker', available: ['speaker', 'earpiece'] }),
    stopScreen: () => { calls.stop++; clearInterval(timer); return true; },
    shareScreen: () => { calls.share++; setTimeout(() => {
      const ch = new MessageChannel(); port = ch.port1; window.__appPort = port;
      window.postMessage('doca-screen', location.origin, [ch.port2]);
      port.postMessage(JSON.stringify({ what: 'started', width: 1080, height: 2400 }));
      const c = Object.assign(document.createElement('canvas'), { width: 270, height: 600 }), g = c.getContext('2d'); let n = 0;
      timer = setInterval(() => { g.fillStyle = n++ % 2 ? '#2a6' : '#a26'; g.fillRect(0, 0, 270, 600); g.fillStyle = '#fff'; g.fillText('phone ' + n, 20, 40);
        port.postMessage(c.toDataURL('image/jpeg', 0.7).split(',')[1]); }, 120);
    }, 300); return 'asking'; },
  };
})();`;

test('a phone in the app shares its screen through the app, and the app hears the meeting open and close', { skip, timeout: 300000 }, async () => {
  const a = await browser(alice, 'alice2'), b = await browser(bob, 'bob2');
  await b.page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_APP });
  await a.page.send('Page.navigate', { url: `${H.base}/` });
  assert.ok(await a.until("typeof meetingStart === 'function' && document.readyState === 'complete' && typeof _liveScreen !== 'undefined'"), 'the panel loaded');
  const { id } = await a.eval(`meetingStart({ people: [${JSON.stringify(bob.user.id)}], title: 'Phone share' })`, true);
  await b.page.send('Page.navigate', { url: `${H.base}/meet/${id}` });
  assert.ok(await b.until(`MEET.id === '${id}' && MEET.peers.size === 1`), 'the phone joined by the link');
  assert.ok(await b.until(`window.__app.meeting.some(m => m.open && m.id === '${id}' && m.link.endsWith('/meet/${id}'))`), 'the app is told the meeting is open (its service keeps the call alive)');
  assert.ok(await b.until("!!document.querySelector('#meet .meet-ctl') && /Speaker/.test(document.querySelector('#meet .meet-ctl').textContent)"), 'where the sound goes is a button');
  assert.ok(await a.until("MEET.peers.size === 1 && [...MEET.peers.keys()].every(p => MEET.mesh.state(p) === 'connected')", 90000), `connected — ${await a.why()}`);

  assert.equal(await b.eval('meetShareStart().then(() => !!MEET.screen, e => String(e))', true), true, 'the share started through the app');
  assert.equal(await b.eval('window.__app.share'), 1);
  assert.ok(await a.until("(document.querySelector('#meet .meet-stage video')?.videoWidth || 0) > 0", 60000), `Alice sees the phone's screen — ${await a.why()}`);
  assert.ok(await a.until('[...MEET.peers.values()].some(p => p.sharing?.width === 1080 && p.sharing?.height === 2400)'), 'the share carries the phone\'s own pixels');
  await a.shot('9-alice-sees-phone-share.png'); await b.shot('10-phone-sharing-through-app.png');

  // The app ends the capture (Android's own chip, or its notification): the room hears the share stop.
  await b.eval("window.__appPort.postMessage(JSON.stringify({ what: 'ended', why: 'stopped from the phone' }))");
  assert.ok(await b.until('!MEET.screen'), 'the share stops on the phone');
  assert.ok(await a.until("!document.querySelector('#meet .meet-stage')"), 'and leaves the stage');
  assert.ok(await b.eval('window.__app.stop >= 1'), 'the app is told to stop capturing');

  // Leave from the app's notification: the page leaves, and tells the app the meeting closed.
  await b.eval("window.dispatchEvent(new CustomEvent('doca-meeting', { detail: { action: 'leave' } }))");
  assert.ok(await b.until('!MEET.id'), 'Leave in the notification leaves');
  assert.ok(await b.until('window.__app.meeting.at(-1).open === false'), 'the app is told it closed');
  assert.ok(await a.until('MEET.peers.size === 0'), 'Alice sees the phone go');
  assert.deepEqual([...a.errors, ...b.errors], [], 'no page error');
});

'use strict';

/**
 * What a computer lends the hive (docs/design/hive.md §3.2, §4): a shell, its
 * files, its screen (screenshots, recordings, mouse and keys through xdotool)
 * and a real Chromium driven over CDP. Each tool returns MCP content: text, or
 * an image / a file the hub keeps as an attachment (mcp/client.js keep()).
 *
 * The browser is read the way an accessibility tree is: visible interactive
 * elements get a number (`data-doca-ref`), and clicking or typing is done by
 * that number with real input events, so pages behave as they would for a
 * person.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Cdp } = require('./cdp');

const WORK = process.env.WORKDIR || path.join(process.env.HOME || '/home/agent', 'work');
const RECORDINGS = path.join(WORK, 'recordings');
const DISPLAY = process.env.DISPLAY || ':1';
const SIZE = process.env.SCREEN || '1280x800';
const MAX_OUT = 40000;
const cdp = new Cdp(Number(process.env.CDP_PORT) || 9222);
let recording = null;
// A test computer (the hub's mark, modules/computers/test-mode.js — the owner's decision of 2026-10-08): set only by
// the hub, with its key, each time it connects; a restarted control server starts as an ordinary computer.
let testMode = false;

const text = t => ({ content: [{ type: 'text', text: String(t) }] });
const fail = t => ({ content: [{ type: 'text', text: String(t) }], isError: true });
const clip = s => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n… (${s.length - MAX_OUT} more characters)` : s);
const abs = p => path.resolve(WORK, String(p || '.').replace(/^~(?=$|\/)/, process.env.HOME || '/home/agent'));

/**
 * Run a command and answer with its exit code and output — by its timeout at the latest, whatever it started.
 *
 * A command that backgrounds a process (`server &`, `nohup … &`) leaves that process holding the output pipes, so
 * waiting for them to close waited for ever; and the timeout killed only bash, not what bash started (self-test round
 * two, B3: a 120 s call answered after more than 5 minutes). So the command gets a process group of its own, and the
 * answer comes when the command itself has exited (plus a moment for its last output), or at the timeout — when the
 * whole group is killed. What was read so far is returned, with a line saying which of the two happened.
 */
function run(cmd, args, { timeoutSec = 120, input } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: fs.existsSync(WORK) ? WORK : '/', env: { ...process.env, DISPLAY }, detached: true });
    let out = '', done = false, grace = null;
    const finish = (code, note) => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(grace);
      if (note) out += `\n${note}`;
      child.stdout.destroy(); child.stderr.destroy();   // stop reading; what a background process writes is its own
      resolve({ code, out });
    };
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      finish(null, `(stopped after ${timeoutSec} s: the command and everything it started were ended; the output above is what it wrote until then)`);
    }, timeoutSec * 1000);
    child.on('close', code => finish(code));
    child.on('exit', code => {
      grace = setTimeout(() => finish(code, '(the command ended, but a process it started is still running and holds its output open; '
        + 'what that process writes from here is not read — send its output to a file, e.g. `cmd > log 2>&1 &`)'), 500);
    });
    child.on('error', e => finish(null, `(${e.message})`));
    if (input) child.stdin.end(input);
  });
}

async function grab() {
  const file = path.join(fs.mkdtempSync('/tmp/shot-'), 'screen.png');
  const r = await run('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-video_size', SIZE, '-i', DISPLAY, '-frames:v', '1', '-y', file], { timeoutSec: 20 });
  if (r.code !== 0) throw new Error(r.out || 'screenshot failed');
  return fs.readFileSync(file).toString('base64');
}

/** Number the page's visible interactive elements and describe the page. */
const SNAPSHOT = `(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // Numbers from an earlier snapshot are taken off first: a control numbered then and hidden since kept its number, came
  // first in the page, and a click by that number went to it — at 0,0 — and "worked" (self-test round two, B4).
  document.querySelectorAll('[data-doca-ref]').forEach(el => el.removeAttribute('data-doca-ref'));
  const els = [...document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[onclick],[contenteditable=true]')].filter(vis);
  // A password or card field's value is never read back: the hub fills it from the vault, the agent never sees it (logins.js).
  // So is a field the hub filled one into (browser_fill_secret), until the page goes — even if the page makes it a text field.
  const secret = el => (window.__docaFilled && window.__docaFilled.has(el)) || el.type === 'password' || /cc-|one-time-code|password/.test((el.getAttribute('autocomplete') || '').toLowerCase());
  const label = el => (el.getAttribute('aria-label') || el.innerText || (secret(el) ? (el.value ? '(filled)' : '') : el.value) || el.placeholder || el.title || el.name || el.alt || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  const lines = els.slice(0, 300).map((el, i) => { el.setAttribute('data-doca-ref', String(i + 1));
    const t = el.tagName.toLowerCase() + (el.type ? ':' + el.type : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
    return '[' + (i + 1) + '] ' + t + ' "' + label(el) + '"' + (el.href ? ' -> ' + el.href : ''); });
  return 'title: ' + document.title + '\\nurl: ' + location.href + '\\n\\n' + lines.join('\\n') + '\\n\\n--- text ---\\n' + (document.body ? document.body.innerText : '').slice(0, 12000);
})()`;

/**
 * What a control is, before it is clicked or typed into (TODO H5.4): 'secret' for a password or card field — the agent
 * never types those: a person signs in through Take over — or 'decision' for a control that pays, buys, signs in,
 * confirms or submits a form holding a secret, which needs confirm: true, which the hub always asks a person about
 * (harness/approval.js). Runs in the page; kept a plain function so it can be tested off it.
 */
function sensitive(el) {
  if (!el) return null;
  const ac = String(el.getAttribute && el.getAttribute('autocomplete') || '').toLowerCase();
  if (el.type === 'password' || /cc-|one-time-code|current-password|new-password/.test(ac)) return { kind: 'secret' };
  const label = String((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const form = el.form || (el.closest && el.closest('form'));
  const holdsSecret = !!(form && form.querySelector && form.querySelector('input[type=password],[autocomplete^="cc-"]'));
  const submits = el.type === 'submit' || el.tagName === 'BUTTON';
  if (/\b(pay|buy|purchase|order|checkout|subscribe|donate|transfer|send money|sign in|log ?in|confirm|delete)\b/i.test(label) || (submits && holdsSecret))
    return { kind: 'decision', label: label || el.tagName.toLowerCase() };
  return null;
}

/**
 * What a test computer lets through without a person (the owner's decision of 2026-10-08, self-test #7): a password
 * field — the agent types the test account's password it chose itself; the hub never fills a saved login into a test
 * computer — and a sign-in or log-in, or the submit of a form holding a password. A card field, a one-time code and a
 * control that pays, buys, confirms or deletes stay a person's: a test computer still has the open internet.
 * Runs in the page beside sensitive(), so it is a plain function too.
 */
function signInOnly(el) {
  if (!el) return false;
  const ac = String(el.getAttribute && el.getAttribute('autocomplete') || '').toLowerCase();
  if (/cc-|one-time-code/.test(ac)) return false;
  if (el.type === 'password' || /current-password|new-password/.test(ac)) return true;
  const label = String((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (/\b(pay|buy|purchase|order|checkout|subscribe|donate|transfer|send money|confirm|delete)\b/i.test(label)) return false;
  const form = el.form || (el.closest && el.closest('form'));
  return !(form && form.querySelector && form.querySelector('[autocomplete^="cc-"]'));   // a card in the form is paying
}
const sensitiveAt = ref => cdp.evaluate(`(() => { const el = document.querySelector('[data-doca-ref="${Number(ref)}"]');
  const s = (${sensitive.toString()})(el); return s && { ...s, signIn: (${signInOnly.toString()})(el) }; })()`);
/** Whether this computer lets [ref]'s sign-in through without a person: only a test computer, only signInOnly(). */
const relaxed = s => testMode && !!s?.signIn;
const TAKE_OVER = 'is a password or card field. A person types credentials: ask them to take over this computer (Computers → Take over) and sign in; carry on after they hand it back.';
const NEVER_CARD = 'is a card field or a one-time code: never typed by an agent, on a test computer too — ask the person to take over.';
const confirmFirst = (ref, s) => `[${ref}] is "${s.label}" — it pays, buys, signs in, confirms or submits. A person decides this one: call again with confirm: true and they will be asked.`;

/**
 * Where to click [ref]: its centre once scrolled into view — or why not. A hidden element (gone since the snapshot)
 * and one under another (a dialog, an overlay) are said, not clicked: either click lands on something else, and the
 * tool used to report it as done.
 */
async function centerOf(ref) {
  const r = await cdp.evaluate(`(() => { const el = document.querySelector('[data-doca-ref="${Number(ref)}"]'); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return { hidden: true };
    const x = b.x + b.width / 2, y = b.y + b.height / 2, at = document.elementFromPoint(x, y);
    const name = n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + ' "' + (n.getAttribute('aria-label') || n.innerText || n.title || '').trim().replace(/\\s+/g, ' ').slice(0, 60) + '"';
    return { x, y, covered: !at ? 'nothing (outside the window)' : at === el || el.contains(at) ? null : name(at) }; })()`);
  if (!r) throw new Error(`No element [${ref}] — take a browser_snapshot first; the numbers change when the page does.`);
  if (r.hidden) throw new Error(`[${ref}] is not shown on the page now (hidden, or changed since the snapshot) — take a browser_snapshot and use its numbers.`);
  if (r.covered) throw new Error(`[${ref}] is covered: at its centre is ${r.covered}, which would take the click. Close or answer that first, then take a browser_snapshot.`);
  return r;
}

/** A real mouse: moved there, pressed, released (a page's hover handlers see it as a person's). */
async function click(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

/** Listen, in the page, for where the next click lands — so a click nothing received is said rather than reported done. */
const watchClick = ref => cdp.evaluate(`(() => { window.__docaClicked = null; const el = document.querySelector('[data-doca-ref="${Number(ref)}"]');
  if (window.__docaClickL) removeEventListener('click', window.__docaClickL, true);
  window.__docaClickL = e => { window.__docaClicked = el && el.contains(e.target) ? 'it' : e.target.tagName.toLowerCase(); };
  addEventListener('click', window.__docaClickL, { capture: true, once: true }); })()`);
/** What the click did: 'it', another element's tag, null (nothing received it), or undefined (a new page: it navigated). */
const clicked = () => cdp.evaluate('window.__docaClicked').catch(() => undefined);

const TOOLS = [
  { name: 'shell', description: 'Run a bash command in this computer (a Linux container), in its work folder. Returns the exit code and output.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeoutSec: { type: 'number' } }, required: ['command'] },
    run: async a => { const r = await run('bash', ['-lc', a.command], { timeoutSec: Math.min(1800, a.timeoutSec || 120) }); return text(clip(`exit ${r.code}\n${r.out}`)); } },
  { name: 'read_file', description: 'Read a text file in this computer.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async a => text(clip(fs.readFileSync(abs(a.path), 'utf8'))) },
  { name: 'write_file', description: 'Write a text file in this computer (folders are made).', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async a => { const f = abs(a.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, a.content ?? ''); return text(`Wrote ${Buffer.byteLength(a.content ?? '')} bytes to ${f}`); } },
  { name: 'list_dir', description: 'List a folder in this computer.', inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    run: async a => text(fs.readdirSync(abs(a.path), { withFileTypes: true }).map(e => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`).join('\n') || '(empty)') },
  { name: 'screenshot', description: 'A picture of this computer\'s whole screen (the desktop and every window).', inputSchema: { type: 'object', properties: {} },
    run: async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: await grab() }] }) },
  { name: 'record_start', description: 'Start recording this computer\'s screen to a video (for a demo, or proof of what was done).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, fps: { type: 'number' } } },
    run: async a => {
      if (recording) return fail(`Already recording to ${recording.file}; stop it first.`);
      fs.mkdirSync(RECORDINGS, { recursive: true });
      const file = path.join(RECORDINGS, `${String(a.name || 'recording').replace(/[^\w.-]/g, '_')}-${Date.now()}.mp4`);
      const child = spawn('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-framerate', String(Math.min(30, a.fps || 15)), '-video_size', SIZE, '-i', DISPLAY,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', file], { env: { ...process.env, DISPLAY }, stdio: ['pipe', 'ignore', 'pipe'] });
      recording = { child, file, at: Date.now() };
      return text(`Recording the screen to ${file}. Do the steps, then record_stop.`);
    } },
  { name: 'record_stop', description: 'Stop the recording; the video is handed back (kept by the hub as an attachment).', inputSchema: { type: 'object', properties: {} },
    run: async () => {
      if (!recording) return fail('Nothing is recording.');
      const { child, file, at } = recording;
      recording = null;
      child.stdin.end('q');
      await new Promise(r => { child.on('close', r); setTimeout(() => { child.kill('SIGINT'); r(); }, 8000); });
      const bytes = fs.statSync(file).size, secs = Math.round((Date.now() - at) / 1000);
      if (bytes > 40e6) return text(`Recorded ${secs} s (${Math.round(bytes / 1e6)} MB) at ${file} — too large to hand back here; fetch it from the computer.`);
      return { content: [{ type: 'text', text: `Recorded ${secs} s.` }, { type: 'resource', resource: { uri: `file://${file}`, mimeType: 'video/mp4', blob: fs.readFileSync(file).toString('base64') } }] };
    } },
  { name: 'desktop_click', description: 'Click at x,y on the screen (pixels, from a screenshot).', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'double'] } }, required: ['x', 'y'] },
    run: async a => { const r = await run('xdotool', ['mousemove', String(a.x), String(a.y), 'click', ...(a.button === 'double' ? ['--repeat', '2', '1'] : [a.button === 'right' ? '3' : '1'])]); return r.code === 0 ? text(`Clicked ${a.x},${a.y}.`) : fail(r.out); } },
  { name: 'desktop_type', description: 'Type text into whatever has focus on the screen.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async a => { const r = await run('xdotool', ['type', '--delay', '20', a.text]); return r.code === 0 ? text('Typed.') : fail(r.out); } },
  { name: 'desktop_key', description: 'Press a key or a combination (xdotool names: Return, ctrl+l, alt+Tab).', inputSchema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'] },
    run: async a => { const r = await run('xdotool', ['key', a.keys]); return r.code === 0 ? text(`Pressed ${a.keys}.`) : fail(r.out); } },
  { name: 'browser_open', description: 'Open a URL in this computer\'s Chromium and wait for it to load. Then browser_snapshot to read it.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: async a => { await cdp.connect(); const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: a.url }); await loaded;
      return text(`Opened ${await cdp.evaluate('location.href')} — "${await cdp.evaluate('document.title')}".`); } },
  { name: 'browser_snapshot', description: 'Read the page: its title, URL, every visible link, button and field numbered [n], and its text. Click or type by those numbers.',
    inputSchema: { type: 'object', properties: {} }, run: async () => { await cdp.connect(); return text(clip(await cdp.evaluate(SNAPSHOT))); } },
  { name: 'browser_click', description: 'Click element [ref] from the last browser_snapshot, with a real mouse event. A control that pays, buys, signs in or submits needs confirm: true (a person is asked) — on a test computer a sign-in or a sign-in form\'s submit does not.',
    inputSchema: { type: 'object', properties: { ref: { type: 'number' }, confirm: { type: 'boolean' } }, required: ['ref'] },
    run: async a => { await cdp.connect(); const p = await centerOf(a.ref);
      const s = await sensitiveAt(a.ref);
      if (s?.kind === 'decision' && a.confirm !== true && !relaxed(s)) return fail(confirmFirst(a.ref, s));
      await watchClick(a.ref); await click(p.x, p.y); const got = await clicked(); await new Promise(r => setTimeout(r, 600));
      if (got === null) return fail(`Nothing at [${a.ref}]'s centre (${Math.round(p.x)},${Math.round(p.y)}) received the click. Take a browser_snapshot: the page may have changed.`);
      if (got && got !== 'it') return fail(`The click at [${a.ref}]'s centre landed on a ${got}, not on [${a.ref}]. Take a browser_snapshot and try again.`);
      return text(`Clicked [${a.ref}]. Now at ${await cdp.evaluate('location.href')}.`); } },
  { name: 'browser_type', description: 'Type into field [ref] from the last browser_snapshot; submit presses Enter after. Never a card field; a password field only on a test computer (the test account\'s password you chose) — otherwise a person signs in through Take over.',
    inputSchema: { type: 'object', properties: { ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, confirm: { type: 'boolean' } }, required: ['ref', 'text'] },
    run: async a => { await cdp.connect(); const p = await centerOf(a.ref);
      const s = await sensitiveAt(a.ref);
      if (s?.kind === 'secret' && !relaxed(s)) return fail(`[${a.ref}] ${testMode ? NEVER_CARD : TAKE_OVER}`);
      if (a.submit && a.confirm !== true) {
        const f = await cdp.evaluate(`(() => { const el = document.querySelector('[data-doca-ref="${Number(a.ref)}"]'); const form = el && (el.form || el.closest('form'));
          return !form ? null : form.querySelector('[autocomplete^="cc-"]') ? 'card' : form.querySelector('input[type=password]') ? 'password' : null; })()`);
        if (f === 'card' || (f === 'password' && !testMode)) return fail(confirmFirst(a.ref, { label: 'a form with a password or card field' }));
      } await click(p.x, p.y); await cdp.send('Input.insertText', { text: a.text });
      if (a.submit) for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
      await new Promise(r => setTimeout(r, 400)); return text(`Typed into [${a.ref}]${a.submit ? ' and pressed Enter' : ''}.`); } },
  // The hub fills a password from its vault here (modules/logins.js computer_login): it holds FILL_KEY, the agent does
  // not, and the value never passes through the agent. Hidden from tools/list (agent.js).
  { name: 'browser_fill_secret', hidden: true, description: 'The hub types a stored secret into field [ref].',
    inputSchema: { type: 'object', properties: { ref: { type: 'number' }, value: { type: 'string' }, key: { type: 'string' } }, required: ['ref', 'value', 'key'] },
    run: async a => { if (!process.env.FILL_KEY || a.key !== process.env.FILL_KEY) return fail('Not the hub.');
      await cdp.connect();
      // Only a password field (or one marked for a password or one-time code): a text field would show it in the next snapshot.
      const ok = await cdp.evaluate(`(() => { const el = document.querySelector('[data-doca-ref="${Number(a.ref)}"]');
        if (!el || el.tagName !== 'INPUT' || !(el.type === 'password' || /\\b(current-password|new-password|one-time-code)\\b/.test((el.getAttribute('autocomplete') || '').toLowerCase()))) return false;
        (window.__docaFilled = window.__docaFilled || new WeakSet()).add(el); el.value = ''; return true; })()`);
      if (!ok) return fail(`[${a.ref}] is not a password field: a secret goes only into one.`);
      const p = await centerOf(a.ref); await click(p.x, p.y);
      await cdp.send('Input.insertText', { text: a.value }); return text(`Filled [${a.ref}].`); } },
  // The hub marks a test computer (modules/computers/test-mode.js), with the same key: never the agent's to call.
  { name: 'test_mode', hidden: true, description: 'The hub says whether this is a test computer.',
    inputSchema: { type: 'object', properties: { on: { type: 'boolean' }, key: { type: 'string' } }, required: ['on', 'key'] },
    run: async a => { if (!process.env.FILL_KEY || a.key !== process.env.FILL_KEY) return fail('Not the hub.');
      testMode = a.on === true; return text(testMode ? 'A test computer: sign-ins without asking.' : 'An ordinary computer.'); } },
  { name: 'browser_screenshot', description: 'A picture of the page as the browser draws it.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await cdp.connect(); return { content: [{ type: 'image', mimeType: 'image/png', data: (await cdp.send('Page.captureScreenshot', { format: 'png' })).data }] }; } },
  { name: 'browser_back', description: 'Go back one page.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await cdp.connect(); await cdp.evaluate('history.back()'); await new Promise(r => setTimeout(r, 800)); return text(`Now at ${await cdp.evaluate('location.href')}.`); } },
];

module.exports = { TOOLS, sensitive, signInOnly, run };

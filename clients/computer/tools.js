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

const text = t => ({ content: [{ type: 'text', text: String(t) }] });
const fail = t => ({ content: [{ type: 'text', text: String(t) }], isError: true });
const clip = s => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n… (${s.length - MAX_OUT} more characters)` : s);
const abs = p => path.resolve(WORK, String(p || '.').replace(/^~(?=$|\/)/, process.env.HOME || '/home/agent'));

function run(cmd, args, { timeoutSec = 120, input } = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: fs.existsSync(WORK) ? WORK : '/', env: { ...process.env, DISPLAY } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += `\n(stopped after ${timeoutSec} s)`; }, timeoutSec * 1000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
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
  const els = [...document.querySelectorAll('a[href],button,input,textarea,select,[role=button],[role=link],[role=checkbox],[onclick],[contenteditable=true]')].filter(vis);
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.name || el.alt || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  const lines = els.slice(0, 300).map((el, i) => { el.setAttribute('data-doca-ref', String(i + 1));
    const t = el.tagName.toLowerCase() + (el.type ? ':' + el.type : '') + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '');
    return '[' + (i + 1) + '] ' + t + ' "' + label(el) + '"' + (el.href ? ' -> ' + el.href : ''); });
  return 'title: ' + document.title + '\\nurl: ' + location.href + '\\n\\n' + lines.join('\\n') + '\\n\\n--- text ---\\n' + (document.body ? document.body.innerText : '').slice(0, 12000);
})()`;

async function centerOf(ref) {
  const r = await cdp.evaluate(`(() => { const el = document.querySelector('[data-doca-ref="${Number(ref)}"]'); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`No element [${ref}] — take a browser_snapshot first; the numbers change when the page does.`);
  return r;
}

async function click(x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}

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
  { name: 'browser_click', description: 'Click element [ref] from the last browser_snapshot, with a real mouse event.', inputSchema: { type: 'object', properties: { ref: { type: 'number' } }, required: ['ref'] },
    run: async a => { await cdp.connect(); const p = await centerOf(a.ref); await click(p.x, p.y); await new Promise(r => setTimeout(r, 600));
      return text(`Clicked [${a.ref}]. Now at ${await cdp.evaluate('location.href')}.`); } },
  { name: 'browser_type', description: 'Type into field [ref] from the last browser_snapshot; submit presses Enter after.',
    inputSchema: { type: 'object', properties: { ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['ref', 'text'] },
    run: async a => { await cdp.connect(); const p = await centerOf(a.ref); await click(p.x, p.y); await cdp.send('Input.insertText', { text: a.text });
      if (a.submit) for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
      await new Promise(r => setTimeout(r, 400)); return text(`Typed into [${a.ref}]${a.submit ? ' and pressed Enter' : ''}.`); } },
  { name: 'browser_screenshot', description: 'A picture of the page as the browser draws it.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await cdp.connect(); return { content: [{ type: 'image', mimeType: 'image/png', data: (await cdp.send('Page.captureScreenshot', { format: 'png' })).data }] }; } },
  { name: 'browser_back', description: 'Go back one page.', inputSchema: { type: 'object', properties: {} },
    run: async () => { await cdp.connect(); await cdp.evaluate('history.back()'); await new Promise(r => setTimeout(r, 800)); return text(`Now at ${await cdp.evaluate('location.href')}.`); } },
];

module.exports = { TOOLS };

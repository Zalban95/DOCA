'use strict';

/**
 * Bluetooth: what this machine's own adapter sees — Linux through BlueZ's `bluetoothctl` (the devices it knows, and a
 * timed discovery of at most 8 s), macOS through `system_profiler SPBluetoothDataType -json` (the devices it has
 * paired or seen); Windows is said plainly as not supported yet. All by argv.
 *
 * Pairing (Linux only) is a person's click, after a confirmation: bluetoothctl is started with an agent, asked to pair,
 * and what it asks back — "Confirm passkey 123456", "Enter PIN code" — is relayed to the person (session()), whose
 * answer is typed back; then it is trusted and connected. Nothing here pairs on its own, and the agent never pairs.
 */
const { spawn } = require('child_process');
const { run } = require('./lan');

const ADDR = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;
const valid = a => ADDR.test(String(a || ''));

/** `bluetoothctl devices` (and a scan's "[NEW] Device …" lines) → [{address, name}]. */
function parseDevices(text) {
  const out = new Map();
  for (const line of String(text || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const m = /(?:^|\s)Device\s+([0-9A-F]{2}(?::[0-9A-F]{2}){5})\s+(.*)$/i.exec(line);
    if (!m || /RSSI:|TxPower:|ManufacturerData|ServiceData|Connected:|Paired:|UUIDs:/.test(m[2])) continue;
    const address = m[1].toUpperCase(), name = m[2].trim();
    // A device with no name is listed by its address with dashes: keep it, but nameless.
    out.set(address, { address, name: name && name.replace(/-/g, ':').toUpperCase() !== address ? name : null });
  }
  return [...out.values()];
}

/** `bluetoothctl info <addr>` → {name, icon, paired, connected, trusted, audio}. */
function parseInfo(text) {
  const t = String(text || '');
  const val = k => (new RegExp(`^\\s*${k}:\\s*(.+)$`, 'mi').exec(t) || [])[1]?.trim() || null;
  const uuids = [...t.matchAll(/UUID:\s*([^(\n]+)/g)].map(m => m[1].trim());
  const alias = val('Alias');
  return { name: val('Name') || (alias && !/^([0-9A-F]{2}-){5}[0-9A-F]{2}$/i.test(alias) ? alias : null), icon: val('Icon'), paired: val('Paired') === 'yes', connected: val('Connected') === 'yes',
    trusted: val('Trusted') === 'yes', audio: uuids.some(u => /Audio Sink|Headset|Handsfree|A\/V Remote/i.test(u)), uuids };
}

/** macOS' system_profiler JSON → [{address, name, kind, connected, paired}]. */
function parseMac(json) {
  let d;
  try { d = JSON.parse(json); } catch { return []; }
  const root = (d.SPBluetoothDataType || [])[0] || {};
  const out = [];
  for (const [key, connected] of [['device_connected', true], ['device_not_connected', false], ['device_paired', null]]) {
    for (const entry of [].concat(root[key] || [])) {
      for (const [name, v] of Object.entries(entry || {})) {
        const address = String(v?.device_address || '').toUpperCase().replace(/-/g, ':');
        if (!valid(address) || out.some(o => o.address === address)) continue;
        out.push({ address, name, icon: v.device_minorType || null, connected: connected === true, paired: true });
      }
    }
  }
  return out;
}

/** Whether there is an adapter, and it is on (`bluetoothctl show`). */
const parseShow = text => ({ controller: /Controller\s+[0-9A-F:]{17}/i.test(text || ''), powered: /Powered:\s*yes/i.test(text || '') });

/** What is around, for this OS: {devices, why} — `why` says when nothing could be looked at. */
async function look({ platform = process.platform, exec = run, scanSec = 8 } = {}) {
  if (platform === 'win32') return { devices: [], why: 'Bluetooth is not read on Windows yet.' };
  if (platform === 'darwin') {
    const j = await exec('system_profiler', ['SPBluetoothDataType', '-json'], 15000);
    return j ? { devices: parseMac(j) } : { devices: [], why: 'system_profiler did not answer.' };
  }
  const show = await exec('bluetoothctl', ['show'], 4000);
  if (show === null) return { devices: [], why: 'bluetoothctl is not installed (BlueZ).' };
  const s = parseShow(show);
  if (!s.controller) return { devices: [], why: 'No Bluetooth adapter on this machine.' };
  if (!s.powered) return { devices: [], why: 'The Bluetooth adapter is off.' };
  const scanned = await exec('bluetoothctl', ['--timeout', String(Math.min(10, Math.max(1, scanSec))), 'scan', 'on'], (scanSec + 4) * 1000) || '';
  const known = parseDevices(await exec('bluetoothctl', ['devices'], 4000) || '');
  const all = new Map([...parseDevices(scanned), ...known].map(d => [d.address, d]));
  const list = [...all.values()].slice(0, 40);
  const infos = [];
  for (let i = 0; i < list.length; i += 6) infos.push(...await Promise.all(list.slice(i, i + 6).map(d => exec('bluetoothctl', ['info', d.address], 3000))));
  return { devices: list.map((d, i) => { const info = parseInfo(infos[i]); return { ...info, address: d.address, name: info.name || d.name }; }) };
}

/* ── Pairing: one session per address, a person's click ── */

const sessions = new Map();

/**
 * Reads bluetoothctl's lines into a state: {state: working|confirm|pin|passkey|paired|failed, passkey, message}. Pure, so
 * a test drives it with lines.
 */
function step(st, line) {
  const l = String(line).replace(/\x1b\[[0-9;]*m/g, '');
  let m;
  if ((m = /Confirm passkey\s+(\d+)/i.exec(l))) return { ...st, state: 'confirm', passkey: m[1], message: `Does the other device show ${m[1]}? Answer yes only if it does.` };
  if (/Enter PIN code/i.test(l)) return { ...st, state: 'pin', message: 'It asks for a PIN code: type the one the device shows or its manual gives (often 0000).' };
  if (/Enter passkey/i.test(l)) return { ...st, state: 'passkey', message: 'It asks for a passkey: type the number the device shows.' };
  if ((m = /Passkey:\s*(\d+)/i.exec(l))) return { ...st, state: 'working', passkey: m[1], message: `Type ${m[1]} on the other device, then Enter.` };
  if (/Pairing successful/i.test(l)) return { ...st, state: 'paired', message: 'Paired. Trusting and connecting it…' };
  if (/Failed to pair|AuthenticationFailed|AuthenticationCanceled|not available/i.test(l)) {
    return { ...st, state: 'failed', message: `It did not pair: ${l.replace(/^.*?(Failed|org\.bluez)/, '$1').trim()}. Pairing often has to be started on the device too — put it in pairing mode and try again.` };
  }
  if (/Connection successful/i.test(l)) return { ...st, connected: true };
  return st;
}

/** Start pairing one address; resolves with the first state worth showing (a question, success or failure). */
function pair(address, { spawnFn = spawn, waitMs = 25000 } = {}) {
  if (process.platform !== 'linux' && spawnFn === spawn) return Promise.resolve({ state: 'failed', message: 'Pairing from DOCA works on Linux only for now: pair it in this machine\'s Bluetooth settings.' });
  address = String(address || '').toUpperCase();
  if (!valid(address)) return Promise.resolve({ state: 'failed', message: 'That is not a Bluetooth address.' });
  sessions.get(address)?.child?.kill();
  const child = spawnFn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const s = { address, child, st: { state: 'working', message: 'Pairing…' }, waiters: [], at: Date.now() };
  sessions.set(address, s);
  const tell = () => { const w = s.waiters.splice(0); for (const f of w) f(view(s)); };
  let buf = '';
  const onData = d => {
    buf += String(d);
    const lines = buf.split(/\r?\n|\r/);
    buf = lines.pop();
    for (const line of lines) {
      const was = s.st.state;
      s.st = step(s.st, line);
      if (s.st.state === 'paired' && was !== 'paired') { child.stdin.write(`trust ${address}\nconnect ${address}\n`); setTimeout(() => { try { child.stdin.write('quit\n'); } catch { /* gone */ } }, 6000).unref?.(); }
      if (s.st.state !== was) tell();
    }
  };
  child.stdout.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', e => { s.st = { state: 'failed', message: `bluetoothctl could not start: ${e.message}` }; tell(); });
  child.on('exit', () => { if (!['paired', 'failed'].includes(s.st.state)) s.st = { ...s.st, state: 'failed', message: 'bluetoothctl ended before it paired.' }; s.child = null; tell(); });
  child.stdin.write(`agent KeyboardDisplay\ndefault-agent\npair ${address}\n`);
  const timer = setTimeout(() => { if (s.st.state === 'working') { s.st = { state: 'failed', message: 'No answer from the device: put it in pairing mode and try again.' }; child.kill(); tell(); } }, waitMs);
  timer.unref?.();
  return new Promise(resolve => s.waiters.push(resolve));
}

/** The person's answer to what pairing asked: yes/no for a passkey, the PIN or passkey typed. */
function answer(address, said) {
  const s = sessions.get(String(address || '').toUpperCase());
  if (!s?.child || !['confirm', 'pin', 'passkey'].includes(s.st.state)) return Promise.resolve({ state: 'failed', message: 'Nothing is waiting for an answer: start pairing again.' });
  const text = s.st.state === 'confirm' ? (/^y/i.test(String(said)) ? 'yes' : 'no') : String(said || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 16);
  s.st = { ...s.st, state: 'working', message: 'Answered — waiting for the device…' };
  s.child.stdin.write(`${text}\n`);
  return new Promise(resolve => s.waiters.push(resolve));
}

const view = s => ({ address: s.address, state: s.st.state, passkey: s.st.passkey || null, message: s.st.message, connected: !!s.st.connected });

module.exports = { parseDevices, parseInfo, parseMac, parseShow, look, step, pair, answer, valid, _sessions: sessions };

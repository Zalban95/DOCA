'use strict';

/**
 * DOCA's Task Scheduler entry on Windows: start the launcher when this person signs in (TODO H1.3, H1.9).
 *
 * Run on a real Windows 11 desk (2026-10-08), the `schtasks /Create /SC ONLOGON` this replaced was wrong four ways:
 *   - From an ordinary (not elevated) prompt it answered "Access is denied": its trigger is "at log on of any user",
 *     which only an administrator may create, so the installer and the Settings toggle failed for a newcomer. A
 *     trigger for this one account is the person's own to create.
 *   - With no ExecutionTimeLimit, Task Scheduler's default of 72 hours stopped DOCA after three days running.
 *   - node.exe is a console program, so signing in opened a terminal window holding DOCA, which closing stopped.
 *     conhost --headless gives it a console nobody sees.
 *   - The name is fixed, and any entry of that name was called this install's: a second DOCA on the machine (a
 *     trial beside the one in use) reported the first one's entry as its own, and its switch-off deleted it. The
 *     entry's own command says which launcher it starts, which is how its install is known — as modules/startup.js
 *     otherInstall does for the systemd unit. Switching on still takes the entry over, as on Linux, and says so.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TASK = 'DOCA';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The account the entry belongs to, as Windows names it. USERDOMAIN is not it: an SSH session reports WORKGROUP. */
function account() {
  const r = spawnSync('whoami', [], { encoding: 'utf8', windowsHide: true });
  const name = String(r.stdout || '').trim();
  return r.status === 0 && name ? name : `${process.env.COMPUTERNAME || os.hostname()}\\${os.userInfo().username}`;
}

/** The entry: at this account's sign-in, as this account without elevation, no time limit, no window, output to `log`. */
function taskXml({ node, script, dir, log, user }) {
  const args = `--headless "${node}" "${script}" start --log "${log}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${esc(`Starts DOCA (${dir}) when ${user} signs in.`)}</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>conhost.exe</Command><Arguments>${esc(args)}</Arguments><WorkingDirectory>${esc(dir)}</WorkingDirectory></Exec></Actions>
</Task>
`;
}

/** The launcher an entry starts, from its XML (schtasks /Query /XML); null when it names none. */
function launcherOf(xml) {
  const m = /"([^"]*doca-launch\.js)"/i.exec(String(xml || '').replace(/&quot;/g, '"'));
  return m ? m[1] : null;
}

// Windows paths whatever runs this (the tests read them on Linux too), compared as Windows does: without case.
const same = (a, b) => !!a && !!b && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
/** The DOCA folder a launcher path belongs to (…\bin\doca-launch.js). */
const installOf = launcher => path.win32.dirname(path.win32.dirname(launcher));

function schtasks(args) {
  const r = spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/** Whose the entry is: { exists, ours, elsewhere } — elsewhere is the other install's folder. */
function owner(script, query = () => schtasks(['/Query', '/TN', TASK, '/XML'])) {
  const q = query();
  if (!q.ok) return { exists: false, ours: false, elsewhere: null };
  const theirs = launcherOf(q.out);
  if (!theirs || same(theirs, script)) return { exists: true, ours: true, elsewhere: null };   // ours, or one we cannot read: as before
  return { exists: true, ours: false, elsewhere: installOf(theirs) };
}

/** Turning it on means this DOCA, as the systemd unit does on Linux: an entry that started another one is taken over, and says so. */
function enable({ node, script, dir }) {
  const who = owner(script);
  const file = path.join(os.tmpdir(), `doca-task-${process.pid}.xml`);
  // UTF-16 with its byte-order mark, as the XML declares: schtasks reads the file by it.
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml({ node, script, dir, log: path.join(dir, 'restart.log'), user: account() }), 'utf16le')]));
  try {
    const r = schtasks(['/Create', '/TN', TASK, '/XML', file, '/F']);
    return who.elsewhere && r.ok ? { ...r, out: `${r.out}\nIt started the DOCA in ${who.elsewhere} until now; it starts this one (${dir}) instead.`, took: who.elsewhere } : r;
  } finally { fs.rmSync(file, { force: true }); }
}

function disable({ script }) {
  const who = owner(script);
  if (!who.exists) return { ok: true, out: 'There was no entry to remove.' };
  if (who.elsewhere) return { ok: false, elsewhere: who.elsewhere, out: `The Task Scheduler entry "${TASK}" starts another DOCA (${who.elsewhere}); it is left alone.` };
  return schtasks(['/Delete', '/TN', TASK, '/F']);
}

function status({ script }) {
  const who = owner(script);
  return { ok: who.ours, ...(who.elsewhere ? { elsewhere: who.elsewhere } : {}), out: who.exists ? `Task Scheduler: ${TASK}` : 'no entry' };
}

module.exports = { TASK, taskXml, launcherOf, owner, enable, disable, status, account };

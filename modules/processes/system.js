'use strict';

/**
 * Which processes are the system's rather than a person's (the Processes drawer, asked 2026-10-09: "an eye on other
 * existing non-system processes"). Pure: a process row in, the reason it is the system's out — or null, a person's.
 * The rules, in order, per OS (RULES below is what the drawer shows under "What is left out"):
 *
 *   every OS   a process inside a container is never the system's: a container is something a person started
 *   Linux      a kernel thread (no command line, or a child of kthreadd, pid 2) · init (pid 1) · an account below the
 *              first person's uid (UID_MIN in /etc/login.defs, 1000 by default) or `nobody` · the desktop session: the
 *              user manager's own cgroups (`user@<uid>.service/session.slice`, `init.scope`, `background.slice`) or a
 *              name in DESKTOP (display server, compositor, panel, audio, keyrings, indexers, portals, settings daemons)
 *   macOS      the kernel and launchd (pid 0, 1) · an account below 501 (root and the `_` daemons) · a program under
 *              /System, /usr/libexec, /usr/sbin, /sbin or /Library/Apple · a name in DESKTOP (Finder, Dock, WindowServer…)
 *   Windows    System Idle and System (pid 0, 4) · session 0 (services) · a program under the Windows folder, except the
 *              shells and tools a person runs from there (PERSON_TOOLS: cmd, PowerShell, WSL, ssh, Notepad…) · a name
 *              in DESKTOP (Explorer, the shell hosts, input and search hosts)
 */
const DESKTOP = {
  linux: [/^(Xorg|Xwayland|X)$/, /^gnome-(shell|session|keyring|remote-de|software)/, /^gsd-/, /^gdm/, /^mutter/, /^kwin/, /^plasmashell$/,
    /^ksmserver$/, /^kded\d*$/, /^kglobalaccel/, /^kactivitymanage/, /^baloo/, /^xfce4-/, /^xfwm4$/, /^xfdesktop$/, /^xfsettingsd$/, /^lx(panel|session)$/,
    /^openbox$/, /^(sway|swaybg|waybar|Hyprland|i3|i3bar|picom|polybar)$/, /^pipewire/, /^wireplumber$/, /^pulseaudio$/,
    /^dbus-(daemon|broker)/, /^at-spi/, /^gvfs/, /^xdg-/, /^evolution-/, /^ibus/, /^fcitx/, /^tracker-/, /^localsearch/,
    /^dconf-service$/, /^gcr-/, /^(ssh|gpg)-agent$/, /^mpris-proxy$/, /^update-notifier$/, /^snapd-desktop-/, /^user-session-he/,
    /^polkit/, /^goa-/, /^zeitgeist/, /^obexd$/, /^systemd$/, /^\(sd-pam\)$/, /^gnome-session-/, /^nautilus-desktop$/,
    /^firmware-notifi/, /^dart:firmware/, /^evolution-alarm/, /^colord/, /^geoclue/, /^kerneloops/, /^sd_espeak/, /^speech-dispatch/],
  darwin: [/^(WindowServer|loginwindow|Dock|Finder|SystemUIServer|ControlCenter|NotificationCenter|Spotlight|launchd|cfprefsd|distnoted|UserEventAgent|universalaccessd|sharingd|corespotlightd|mds|mds_stores|mdworker.*|trustd|secd|nsurlsessiond|AirPlayUIAgent|TextInputMenuAgent|WallpaperAgent|Siri.*|talagent|pboard|usernoted|CommCenter|callservicesd|rapportd|bird|cloudd)$/],
  win32: [/^(System|Idle|Registry|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|fontdrvhost|explorer|sihost|ctfmon|taskhostw|RuntimeBroker|SearchHost|SearchIndexer|StartMenuExperienceHost|ShellExperienceHost|TextInputHost|SecurityHealthSystray|dllhost|conhost|LockApp|ApplicationFrameHost|SystemSettings|UserOOBEBroker|backgroundTaskHost|smartscreen|MsMpEng|NisSrv|audiodg|spoolsv|WmiPrvSE|Widgets|WidgetService|PhoneExperienceHost|CrossDeviceResume)$/i],
};
const PERSON_TOOLS = /^(cmd|powershell|pwsh|wsl|wslhost|bash|ssh|scp|sftp|notepad|mstsc|curl|tar|winget|robocopy|xcopy|where|whoami|ping|tracert|nslookup)$/i;
const MAC_SYSTEM = /^\/(System|usr\/libexec|usr\/sbin|sbin|Library\/Apple)\//;
const WIN_DIR = /^[A-Za-z]:\\Windows\\/i;
const SESSION_CGROUP = /\/user@\d+\.service\/(session\.slice|init\.scope|background\.slice)(\/|$)/;

const RULES = {
  linux: ['kernel threads', 'init (pid 1)', 'accounts below the first person\'s (system users)', 'the desktop session: display server, compositor, panel, audio, keyrings, indexers'],
  darwin: ['the kernel and launchd', 'accounts below 501 (root and the system daemons)', 'programs under /System, /usr/libexec, /usr/sbin, /sbin and /Library/Apple', 'the desktop: Finder, Dock, WindowServer and the like'],
  win32: ['System and System Idle', 'services (session 0)', 'programs in the Windows folder, except the shells and tools people run from there', 'the desktop: Explorer and the shell hosts'],
};

/** Why `p` is the system's, or null. `ctx`: { os, uidMin }; `p.containerId` set means a container (never the system's). */
function reason(p, { os = process.platform, uidMin = 1000 } = {}) {
  if (p.containerId) return null;
  const name = String(p.name || '');
  if (os === 'win32') {
    if (p.kernel) return 'the kernel';
    if (p.session === 0) return 'a service';
    if (p.exe && WIN_DIR.test(p.exe) && !PERSON_TOOLS.test(name)) return 'part of Windows';
    if (DESKTOP.win32.some(r => r.test(name))) return 'the desktop';
    return null;
  }
  if (os === 'darwin') {
    if (p.kernel || p.pid === 1) return 'the kernel or launchd';
    if (p.uid != null && p.uid < (uidMin || 501)) return 'a system account';
    if (p.exe && MAC_SYSTEM.test(p.exe)) return 'part of macOS';
    if (DESKTOP.darwin.some(r => r.test(name))) return 'the desktop';
    return null;
  }
  if (p.kernel || p.pid === 2 || p.ppid === 2) return 'a kernel thread';
  if (p.pid === 1) return 'init';
  if (p.uid != null && (p.uid < (uidMin || 1000) || p.uid === 65534)) return 'a system account';
  if (p.cgroup && SESSION_CGROUP.test(p.cgroup)) return 'the desktop session';
  if (DESKTOP.linux.some(r => r.test(name))) return 'the desktop session';
  return null;
}

/** The container a process is in, from its cgroup: Docker's and Podman's 64-hex id, or null. */
function containerOf(cgroup) {
  const m = /(?:docker|libpod|cri-containerd|crio)[-/]([0-9a-f]{64})/.exec(String(cgroup || ''));
  return m ? m[1] : null;
}

module.exports = { reason, containerOf, RULES, DESKTOP, PERSON_TOOLS };

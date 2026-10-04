#!/usr/bin/env bash
#
# DOCA launcher.
#
#   ./run.sh            start the panel in the foreground
#   ./run.sh enable     start DOCA at boot (writes a systemd unit; needs sudo)
#   ./run.sh disable    stop starting at boot; a running panel is left alone
#   ./run.sh status     is the boot service installed, and is it running?
#   ./run.sh versions   list the versions, and which one runs
#   ./run.sh use VER    switch to a version (a tag like v2.53.0, or "checkout") —
#                       the way back when the dashboard itself will not load
#
#   ./run.sh setup-code          the code that sets up the first account
#   ./run.sh reset-password EMAIL  a one-time password for that account (signs it out everywhere)
#
# Settings → General → "Start at Boot" drives the same three verbs, so the
# dashboard and the command line can never drift apart.

set -euo pipefail

DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
SERVICE=openclaw-panel.service
UNIT=/etc/systemd/system/$SERVICE

# The dashboard runs us with no terminal and feeds sudo its password through an
# askpass helper; a human on a tty gets the usual prompt. Already root: neither.
as_root() {
  if   [ "$(id -u)" = 0 ];            then "$@"
  elif [ -n "${SUDO_ASKPASS:-}" ];    then sudo -A "$@"
  else                                     sudo "$@"
  fi
}

need_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "✗ systemctl not found — starting at boot needs systemd." >&2
    exit 1
  fi
}

RELEASES="$DIR/.releases"

# Starting is bin/doca-launch.js — the same launcher on Linux, Windows and macOS (docs/design/hive.md §7):
# the environment from .env, the version in .releases/current, a switched-to version watched for 90 s and
# put back if it does not answer. It was bash here, which a Windows host does not have.
start() {
  cd "$DIR"
  exec node "$DIR/bin/doca-launch.js" start
}

versions() {
  cd "$DIR" && DOCA_HOME="$DIR" node -e '
    require("./modules/releases").list().then(l => {
      for (const v of l.versions) console.log(`${v.current ? "*" : " "} ${v.tag.padEnd(10)} ${
        v.tag === "checkout" ? v.head : `released ${v.releasedAt.slice(0, 10)}${v.installedAt ? `, installed ${v.installedAt.slice(0, 16)}` : ""}`}${
        v.compatible ? "" : "  (too old: would not find your data)"}`);
      if (l.warning) console.log(l.warning);
    }).catch(e => { console.error(e.message); process.exit(1); });'
}

setup_code() {
  if [ -f "$DIR/.setup-code" ]; then cat "$DIR/.setup-code"; echo
  else echo "No setup code: either an account exists already, or the panel has not been opened since it started." >&2; exit 1; fi
}

# Having a shell on this host is already having everything, so this opens
# nothing new: it is the way back for an owner who lost their password.
reset_password() {
  [ -n "${1:-}" ] || { echo "usage: $0 reset-password <email>" >&2; exit 2; }
  cd "$DIR" && DOCA_HOME="$DIR" DOCA_DATA_DIR="${DOCA_DATA_DIR:-$DIR/.doca}" node -e '
    const S = require("./modules/auth/store"), C = require("./modules/auth/credentials");
    (async () => {
      const u = S.userByEmail(process.argv[1]);
      if (!u) { console.error(`No account for ${process.argv[1]}.`); process.exit(1); }
      const once = C.oneTimePassword();
      S.updateUser(u.id, { passwordHash: await C.hashPassword(once), mustChangePassword: true, suspendedAt: null });
      S.deleteSessionsOf(u.id);
      S.audit({ actorId: null, subjectId: u.id, via: "run.sh", action: "password reset on the host" });
      console.log(`One-time password for ${u.email}: ${once}\nIt must be replaced at the next sign-in. Every session of this account was signed out.`);
    })();' "$1"
}

use_version() {
  [ -n "${1:-}" ] || { echo "usage: $0 use <vX.Y.Z|checkout> [--force]" >&2; exit 2; }
  cd "$DIR" && DOCA_HOME="$DIR" node -e '
    require("./modules/releases").use(process.argv[1], { force: process.argv[2] === "--force", by: "cli",
      restart: false, say: s => process.stdout.write(s) })
      .catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });' "$1" "${2:-}"
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE"; then
    echo "Restarting $SERVICE…"
    as_root systemctl restart "$SERVICE"
  else
    echo "Start it with: $0"
  fi
}

write_unit() {
  # Run as the invoking user, not root: the panel reads and writes that user's
  # ~/.openclaw, workspace and prefs.
  as_root tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=DOCA Panel
Documentation=https://github.com/Zalban95/DOCA
Wants=network-online.target
After=network-online.target
# Keep trying forever. With the default start limit (5 attempts in 10s) a brief
# crash loop makes systemd give up and leaves the dashboard down for good.
StartLimitIntervalSec=0

[Service]
Type=simple
User=${SUDO_USER:-$(id -un)}
WorkingDirectory=$DIR
ExecStart=/bin/bash $DIR/run.sh
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
}

enable_boot() {
  need_systemd
  echo "Writing $UNIT"
  write_unit
  as_root systemctl daemon-reload
  as_root systemctl enable "$SERVICE"
  echo "✓ DOCA will start at boot as $SERVICE."
  if systemctl is-active --quiet "$SERVICE"; then
    echo "  systemd already owns the running panel."
  else
    echo "  The panel running now was started by hand, so systemd takes over at"
    echo "  the next boot. To hand over immediately, stop this process and run:"
    echo "    sudo systemctl start $SERVICE"
  fi
}

disable_boot() {
  need_systemd
  # Only stop it from starting at boot: killing the panel someone is using is
  # never what a settings toggle should do.
  as_root systemctl disable "$SERVICE" || true
  echo "✓ DOCA will no longer start at boot."
  if systemctl is-active --quiet "$SERVICE"; then
    echo "  The service is still running. Stop it when you want to:"
    echo "    sudo systemctl stop $SERVICE"
  fi
}

status() {
  need_systemd
  echo "unit:    $UNIT"
  echo "enabled: $(systemctl is-enabled "$SERVICE" 2>/dev/null || echo no)"
  echo "active:  $(systemctl is-active  "$SERVICE" 2>/dev/null || echo no)"
}

case "${1:-start}" in
  start)   start ;;
  enable)  enable_boot ;;
  disable) disable_boot ;;
  status)  status ;;
  versions) versions ;;
  use)     use_version "${2:-}" "${3:-}" ;;
  setup-code)     setup_code ;;
  reset-password) reset_password "${2:-}" ;;
  *) echo "usage: $0 [start|enable|disable|status|versions|use VER|setup-code|reset-password EMAIL]" >&2; exit 2 ;;
esac

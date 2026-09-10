#!/usr/bin/env bash
#
# DOCA launcher.
#
#   ./run.sh            start the panel in the foreground
#   ./run.sh enable     start DOCA at boot (writes a systemd unit; needs sudo)
#   ./run.sh disable    stop starting at boot; a running panel is left alone
#   ./run.sh status     is the boot service installed, and is it running?
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

start() {
  cd "$DIR"
  [ -d node_modules ] || npm install --omit=dev
  # Same environment whether started by hand or by systemd, so the unit does not
  # have to repeat every override (see README → Environment Variables).
  if [ -f .env ]; then set -a; . ./.env; set +a; fi
  exec node server.js
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
  *) echo "usage: $0 [start|enable|disable|status]" >&2; exit 2 ;;
esac

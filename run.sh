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

# The version to start: the tag in .releases/current if it is installed, else
# this checkout. See modules/releases.js.
release_dir() {
  local tag=""
  [ -f "$RELEASES/current" ] && tag=$(tr -d '[:space:]' < "$RELEASES/current")
  if [ -n "$tag" ] && [ -f "$RELEASES/$tag/server.js" ]; then echo "$RELEASES/$tag"; else echo "$DIR"; fi
}

release_log() {   # event to from
  printf '{"at":"%s","event":"%s","to":"%s","from":"%s","by":"launcher"}\n' "$(date -Is)" "$1" "$2" "$3" >> "$RELEASES/log.jsonl"
}

# Does the panel answer on / ? Asked with node, which is certainly here; HTTPS
# first (self-signed, so unverified), then plain HTTP for the fallback server.
answers() {
  node -e '
    const port = process.argv[1], done = ok => process.exit(ok ? 0 : 1);
    const ask = (mod, next) => require(mod).get({ host: "127.0.0.1", port, path: "/", rejectUnauthorized: false, timeout: 4000 },
      r => done(r.statusCode < 500)).on("error", next).on("timeout", function () { this.destroy(); });
    ask("https", () => ask("http", () => done(false)));' "${PORT:-4242}" 2>/dev/null
}

# A version just switched to runs watched: in the background, until it answers.
# If it dies or stays silent for 90 s, switch back and start the previous one.
# The check lives here, not in node, because the new version is exactly the code
# that cannot be trusted to judge itself.
start_watched() {
  local to from pid waited=0 stopping=0
  read -r to from < "$RELEASES/pending"
  node server.js &
  pid=$!
  # Being stopped is not the new version failing: pass it on, and do not revert.
  trap 'stopping=1; kill "$pid" 2>/dev/null || true' TERM INT
  while [ "$waited" -lt 90 ] && [ "$stopping" = 0 ] && kill -0 "$pid" 2>/dev/null; do
    if answers; then
      rm -f "$RELEASES/pending"
      release_log confirm "$to" "$from"
      echo "✓ $to answers — keeping it."
      # Still passing a stop on to node, so a stop never leaves it orphaned.
      local code=0
      wait "$pid" || code=$?
      if kill -0 "$pid" 2>/dev/null; then code=0; wait "$pid" || code=$?; fi
      exit "$code"
    fi
    sleep 3; waited=$((waited + 3))
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  if [ "$stopping" = 1 ]; then exit 0; fi
  if [ "$from" = "checkout" ]; then rm -f "$RELEASES/current"; else echo "$from" > "$RELEASES/current"; fi
  rm -f "$RELEASES/pending"
  release_log revert "$from" "$to"
  echo "✗ $to did not answer within 90 s — switched back to $from." >&2
  exec bash "$DIR/run.sh" start
}

start() {
  cd "$DIR"
  # Same environment whether started by hand or by systemd, so the unit does not
  # have to repeat every override (see README → Environment Variables).
  if [ -f .env ]; then set -a; . ./.env; set +a; fi
  # What outlives a version stays here, whichever version's code runs.
  export DOCA_HOME="$DIR"
  export DOCA_DATA_DIR="${DOCA_DATA_DIR:-$DIR/.doca}"
  export DOCA_PREFS_FILE="${DOCA_PREFS_FILE:-$DIR/.dashboard-prefs.json}"
  local app
  app=$(release_dir)
  cd "$app"
  [ -d node_modules ] || npm install --omit=dev
  if [ -f "$RELEASES/pending" ]; then start_watched; fi
  exec node server.js
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
  *) echo "usage: $0 [start|enable|disable|status|versions|use VER]" >&2; exit 2 ;;
esac

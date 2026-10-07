#!/usr/bin/env bash
# DOCA on Linux or macOS in one command (TODO H1.8; docs/design/hive.md §7):
#   curl -fsSL <raw url>/scripts/install.sh | bash            or            bash scripts/install.sh [options]
# Node 22 is checked (not installed for you: it is your system's), the code fetched (or copied from a checkout),
# its dependencies installed, start-at-boot added (systemd on Linux, launchd on macOS) and the panel started.
#   --dir PATH        where DOCA goes (default ~/doca)
#   --repo URL        where the code comes from (default the DOCA repository; it is private: your git credentials)
#   --from PATH       copy from a checkout instead of cloning (CI uses this)
#   --no-boot         do not add start-at-boot      --no-start   do not start it now
#   --share yes|no    offer the skills and specialists your agents learn to the project (asked when not given)
set -euo pipefail

DIR="${DOCA_DIR:-$HOME/doca}"; REPO="${DOCA_REPO:-https://github.com/Zalban95/DOCA.git}"; FROM=""; BOOT=1; START=1; SHARE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;; --repo) REPO="$2"; shift 2 ;; --from) FROM="$2"; shift 2 ;;
    --no-boot) BOOT=0; shift ;; --no-start) START=0; shift ;; --share) SHARE="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
say() { printf '%s\n' "$*"; }

# ── Node 22 ──
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; then
  say "DOCA needs Node.js 22.5 or newer$(command -v node >/dev/null 2>&1 && printf ' (this machine has %s)' "$(node -v)")."
  case "$(uname -s)" in
    Darwin) say "  Install it with:  brew install node@22   (or from https://nodejs.org)" ;;
    *)      say "  Install it from your distribution, or:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" ;;
  esac
  exit 1
fi
command -v npm >/dev/null 2>&1 || { say "npm is missing beside node; install Node.js with npm."; exit 1; }

# ── The code ──
mkdir -p "$DIR"
if [ -n "$FROM" ]; then
  say "Copying DOCA from $FROM to $DIR"
  # The checkout's tracked files only: its own state (.env, prefs, data, certificates, logs) and anything
  # untracked stay behind. Not a git checkout: everything but that state.
  if git -C "$FROM" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    (cd "$FROM" && git ls-files -z | tar --null -T - -cf -) | (cd "$DIR" && tar -xf -)
  else
    (cd "$FROM" && tar --exclude=./node_modules --exclude=./.doca --exclude=./.releases --exclude=./.git --exclude=./.certs \
      --exclude=./.env --exclude=./.dashboard-prefs.json --exclude=./.setup-code -cf - .) | (cd "$DIR" && tar -xf -)
  fi
elif [ -d "$DIR/.git" ]; then
  say "Updating DOCA in $DIR"; git -C "$DIR" pull --ff-only
else
  command -v git >/dev/null 2>&1 || { say "git is needed to fetch DOCA (or pass --from a checkout)."; exit 1; }
  say "Fetching DOCA into $DIR"; git clone --depth 1 "$REPO" "$DIR"
fi

# ── Dependencies ──
say "Installing its dependencies"
(cd "$DIR" && npm ci --no-audit --no-fund --loglevel=error)

# ── Sharing what the agents learn (CONSTITUTION §0): asked once, the owner's answer; Settings → Packs changes it ──
if [ -z "$SHARE" ] && [ -t 0 ]; then
  printf '[doca] When your agents find a new way to do something, they keep it as a skill or a specialist.\n'
  printf '[doca] Offer those to the DOCA project, so other installs get them too? Nothing is sent without your click. [y/N] '
  read -r SHARE || SHARE=""
fi
case "$SHARE" in
  y|Y|yes|on) (cd "$DIR" && node bin/doca-sharing.js on) ;;
  n|N|no|off|"") [ -n "$SHARE" ] || [ -t 0 ] && (cd "$DIR" && node bin/doca-sharing.js off) || say "Sharing with the project: not decided — Settings → Packs asks." ;;
esac

# ── Start at boot, and now ──
if [ "$BOOT" = 1 ]; then (cd "$DIR" && node bin/doca-launch.js enable) || say "Start-at-boot was not added (see above); DOCA still runs."; fi
if [ "$START" = 1 ]; then
  if [ "$BOOT" = 1 ] && [ "$(uname -s)" = Linux ] && command -v systemctl >/dev/null 2>&1 && systemctl is-enabled --quiet openclaw-panel.service 2>/dev/null; then
    sudo systemctl start openclaw-panel.service
  elif [ "$BOOT" = 1 ] && [ "$(uname -s)" = Darwin ]; then
    :   # launchd started it when the agent was loaded (RunAtLoad)
  else
    # Detached from this script's terminal and pipes: the subshell's own output is the log, and node replaces it.
    (cd "$DIR" && exec nohup node bin/doca-launch.js start > "$DIR/doca.log" 2>&1 < /dev/null) &
  fi
  for _ in $(seq 1 60); do curl -ks -o /dev/null "https://127.0.0.1:${PORT:-4242}/login" && break; sleep 1; done
fi

say ""
say "✓ DOCA is in $DIR."
[ "$START" = 1 ] && say "  Open https://localhost:${PORT:-4242} on this machine to create its owner — no code is needed there."
say "  From another device on your tailnet, the first sign-up asks for the setup code: $DIR/.setup-code (or ./run.sh setup-code)."
say "  The certificate is self-signed: your browser will ask once."

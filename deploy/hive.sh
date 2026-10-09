#!/usr/bin/env bash
# deploy/hive.sh — isolated DOCA hives on one machine, from the hive image (Dockerfile; deploy/README.md).
#
#   hive.sh new <name> [--port N] [--bind ADDR] [--runtime runsc|runc] [--models PORT,PORT] [--cpus N] [--memory SIZE]
#                      [--pids N] [--image IMAGE]
#   hive.sh list | start <name> | stop <name> | code <name>
#   hive.sh backup <name> [FILE]              the hive's volume as a .tgz (stopped for the copy, started again)
#   hive.sh restore <name> <FILE> [new's options]   a new hive from a backup, in a fresh volume — never onto a running one
#   hive.sh remove <name> [--yes]             asks, backs up, then removes the container, its volume and network
#   hive.sh update <name> [--image IMAGE] [--timeout SECONDS]   the new image on the same volume, holding running work:
#                                             the hive stops once nothing runs, a backup is made, the new image starts,
#                                             and the old one again if the new one does not answer
#
# Each hive is a container named <name> with its own volume (<name>-data), network (<name>-net) and limits, no mount
# from this machine, and a port on 127.0.0.1 unless --bind says otherwise. gVisor (runsc) is used when Docker has it.
# Nothing here touches a container, volume or network that is not a hive's (label doca.hive).
set -euo pipefail

IMAGE="${DOCA_HIVE_IMAGE:-doca-hive:latest}"
BACKUPS="${DOCA_HIVE_BACKUPS:-$HOME/doca-hives/backups}"
DOCKER="${DOCKER:-docker}"

say()  { printf '%s\n' "$*"; }
warn() { printf 'hive: %s\n' "$*" >&2; }
die()  { warn "$*"; exit 1; }

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

check_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || die "a hive's name is lower-case letters, digits and -, 2 to 41 characters (got '${1:-}')."
}
is_hive()  { [ "$($DOCKER inspect -f '{{index .Config.Labels "doca.hive"}}' "$1" 2>/dev/null || true)" = "$1" ]; }
running()  { [ "$($DOCKER inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]; }
has_volume() { $DOCKER volume inspect "$1-data" >/dev/null 2>&1; }
need_hive() { check_name "$1"; is_hive "$1" || die "there is no hive called $1 (hive.sh list)."; }

# A hive takes two ports: the panel's and, beside it, the canvases' own origin (modules/canvas/origin.js). Inside the
# container DOCA listens on the same two, so the addresses it hands a browser are the ones published here.
taken() { $DOCKER ps -a --format '{{.Ports}}' | grep -q ":$1->" || (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() {
  local p=4310
  while taken "$p" || taken "$((p + 1))"; do p=$((p + 2)); done
  printf '%s' "$p"
}

# The hive's bridge on this machine, by a name its firewall rules can say (at most 15 characters).
bridge_of() { printf 'dh-%s' "$(printf '%s' "$1" | cksum | cut -d' ' -f1)"; }

# This machine's own services are reachable from a container at its gateway when they listen on every interface.
# A hive is allowed only what --models lists: rules on the hive's bridge, applied when this runs as root, otherwise
# printed to apply (a firewall is this machine's, so hive.sh does not ask for root itself). FIREWALL=0 skips it.
firewall() {   # add|del bridge ports
  local op="$1" br="$2" ports="$3" rules=() p
  rules+=("INPUT -i $br -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT")
  for p in ${ports//,/ }; do rules+=("INPUT -i $br -p tcp --dport $p -j ACCEPT"); done
  rules+=("INPUT -i $br -j DROP")
  [ "${FIREWALL:-1}" = 0 ] && return 0
  if [ "$(id -u)" = 0 ] && command -v iptables >/dev/null; then
    local r
    if [ "$op" = add ]; then
      # Inserted at the top in reverse, so they read in order: what is answered, the model ports, then nothing else.
      for ((i = ${#rules[@]} - 1; i >= 0; i--)); do r="${rules[$i]}"; iptables -C ${r} 2>/dev/null || iptables -I ${r}; done
    else
      for r in "${rules[@]}"; do while iptables -C ${r} 2>/dev/null; do iptables -D ${r}; done; done
    fi
  elif [ "$op" = add ]; then
    warn "not root: this machine's services listening on every interface are reachable from the hive at its gateway."
    warn "To allow only ${ports:-none of them}, run as root (or put these in the firewall):"
    for ((i = ${#rules[@]} - 1; i >= 0; i--)); do warn "  iptables -I ${rules[$i]}"; done
  fi
}

runtimes() { $DOCKER info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}' 2>/dev/null || true; }

# The volume's whole content as a gzip stream on stdout, read by the image's own tar as root (keys are 0600); the
# image has no shell for tar to start gzip with, so it is compressed here.
volume_tar() { $DOCKER run --rm --network none --user 0 --entrypoint tar -v "$1-data:/data:ro" "$IMAGE" -cf - -C /data . | gzip -c; }

create() {   # name, then new's options; RESTORING=1 when the volume already holds a hive
  local name="$1"; shift
  local port="" bind="127.0.0.1" runtime="" models="" cpus="2" memory="2g" pids="512"
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port="$2"; shift 2 ;;
      --bind) bind="$2"; shift 2 ;;
      --runtime) runtime="$2"; shift 2 ;;
      --models) models="$2"; shift 2 ;;
      --cpus) cpus="$2"; shift 2 ;;
      --memory) memory="$2"; shift 2 ;;
      --pids) pids="$2"; shift 2 ;;
      --image) IMAGE="$2"; shift 2 ;;
      *) die "unknown option $1 (hive.sh help)." ;;
    esac
  done
  [ -z "$port" ] && port="$(free_port)"
  [[ "$port" =~ ^[0-9]+$ ]] || die "--port is a number."
  [[ -z "$models" || "$models" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "--models is a list of ports, like 11434,8080."
  $DOCKER image inspect "$IMAGE" >/dev/null 2>&1 || die "no image $IMAGE here: docker build -t $IMAGE . (in DOCA's folder), or docker pull it (deploy/README.md)."

  local rt=()
  if [ -n "$runtime" ]; then
    [[ " $(runtimes) " == *" $runtime "* ]] || die "Docker has no runtime '$runtime' (it has: $(runtimes))."
    rt=(--runtime "$runtime")
  elif [[ " $(runtimes) " == *" runsc "* ]]; then
    rt=(--runtime runsc); runtime=runsc
  else
    warn "gVisor (runsc) is not installed: $name runs under runc and shares this machine's kernel. Install gVisor for a"
    warn "stronger wall between hives (https://gvisor.dev/docs/user_guide/install/), then make the hive again."
    runtime=runc
  fi

  local extra=()
  if [ -n "$models" ]; then
    # The host's inference at one name, models.host, and (with the firewall) only these ports (deploy/README.md).
    extra+=(--add-host "models.host:host-gateway" --label "doca.hive.models=$models")
  fi

  $DOCKER network inspect "$name-net" >/dev/null 2>&1 \
    || $DOCKER network create --label "doca.hive=$name" -o "com.docker.network.bridge.name=$(bridge_of "$name")" "$name-net" >/dev/null
  firewall add "$(bridge_of "$name")" "$models"
  $DOCKER volume inspect "$name-data" >/dev/null 2>&1 \
    || $DOCKER volume create --label "doca.hive=$name" "$name-data" >/dev/null

  $DOCKER run -d --name "$name" --hostname "$name" --label "doca.hive=$name" --label "doca.hive.runtime=$runtime" \
    --label "doca.hive.args=--port $port --bind $bind${models:+ --models $models} --cpus $cpus --memory $memory --pids $pids${runtime:+ --runtime $runtime}" \
    "${rt[@]}" --network "$name-net" -v "$name-data:/data" -e "PORT=$port" -p "$bind:$port:$port" -p "$bind:$((port + 1)):$((port + 1))" \
    --restart unless-stopped --cpus "$cpus" --memory "$memory" --pids-limit "$pids" \
    --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,nosuid,size=256m \
    "${extra[@]}" "$IMAGE" >/dev/null

  say "hive $name: starting on https://$bind:$port, canvases on $((port + 1)) ($runtime, ${cpus} CPUs, $memory, $pids processes)"
  wait_healthy "$name"
  if [ -n "$models" ]; then
    say "  local models: add a provider at http://models.host:<port>/v1 (Field → API keys); the service must listen on the"
    say "  Docker bridge, not only on 127.0.0.1 (deploy/README.md)."
  fi
  if [ "${RESTORING:-0}" = 1 ]; then say "restored: sign in with the accounts the backup holds."; else setup_code "$name" "$bind" "$port"; fi
}

wait_healthy() {
  local i st
  for i in $(seq 1 60); do
    st="$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || true)"
    [ "$st" = healthy ] && return 0
    [ "$st" = exited ] || [ "$st" = dead ] && { $DOCKER logs --tail 20 "$1" >&2 || true; die "$1 stopped while starting (its log is above)."; }
    sleep 2
  done
  die "$1 did not answer within two minutes: docker logs $1"
}

# The owner is made in the panel with a one-time code (modules/auth/routes.js): asked for once from outside the
# container, the hive writes it in its data; it is read from there and never kept anywhere else. No default password.
setup_code() {
  local name="$1" bind="$2" port="$3" host="$2" code=""
  [ "$host" = "0.0.0.0" ] && host=127.0.0.1
  if command -v curl >/dev/null; then curl -ks -o /dev/null "https://$host:$port/api/auth/state" || curl -s -o /dev/null "http://$host:$port/api/auth/state" || true; fi
  code="$($DOCKER exec "$name" node -e "try{process.stdout.write(require('fs').readFileSync('/data/.setup-code','utf8').trim())}catch{}" 2>/dev/null || true)"
  if [ -z "$code" ]; then
    $DOCKER exec "$name" node -e "fetch('https://127.0.0.1:'+process.env.PORT+'/api/auth/state').catch(()=>{})" >/dev/null 2>&1 || true
    code="$($DOCKER logs "$name" 2>&1 | sed -n 's/.*Setup code: \([^ ]*\).*/\1/p' | tail -1)"
  fi
  if [ -n "$code" ]; then
    say ""
    say "  Open https://$host:$port and make its owner with the one-time setup code:  $code"
    say "  (the certificate is self-signed until an address with TLS is in front of it; the code works once.)"
  else
    say "  Open https://$host:$port — it has an owner already, or: hive.sh code $name"
  fi
}

cmd_list() {
  $DOCKER ps -a --filter label=doca.hive --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Label "doca.hive.runtime"}}'
}

cmd_backup() {   # name [file]
  need_hive "$1"
  local name="$1" file="${2:-}" was=0
  [ -z "$file" ] && { mkdir -p "$BACKUPS"; file="$BACKUPS/$name-$(date -u +%Y%m%dT%H%M%SZ).tgz"; }
  running "$name" && { was=1; say "stopping $name for a consistent copy…"; $DOCKER stop -t 30 "$name" >/dev/null; }
  local ok=0
  set -o pipefail; volume_tar "$name" > "$file.part" && ok=1
  [ "$was" = 1 ] && $DOCKER start "$name" >/dev/null
  [ "$ok" = 1 ] || { rm -f "$file.part"; die "the copy of $name's volume failed; nothing was written."; }
  mv "$file.part" "$file"
  say "backup of $name: $file ($(du -h "$file" | cut -f1))"
  BACKUP_FILE="$file"
}

cmd_restore() {   # name file [new's options]
  check_name "$1"
  local name="$1" file="${2:-}"; shift 2 || die "restore needs a hive's name and a backup file."
  [ -f "$file" ] || die "no backup file $file."
  $DOCKER inspect "$name" >/dev/null 2>&1 && die "$name exists: a backup is restored into a new hive, never onto one that is there. Pick another name."
  has_volume "$name" && die "the volume $name-data exists: restore into a new name, or remove that hive first."
  $DOCKER image inspect "$IMAGE" >/dev/null 2>&1 || die "no image $IMAGE here."
  $DOCKER volume create --label "doca.hive=$name" "$name-data" >/dev/null
  if ! gzip -dc < "$file" | $DOCKER run --rm -i --network none --user 0 --entrypoint tar -v "$name-data:/data" "$IMAGE" -xf - -C /data; then
    $DOCKER volume rm "$name-data" >/dev/null || true
    die "$file could not be unpacked; the new volume was removed."
  fi
  RESTORING=1 create "$name" "$@"
}

cmd_remove() {   # name [--yes]
  need_hive "$1"
  local name="$1" yes="${2:-}"
  if [ "$yes" != "--yes" ]; then
    printf 'Remove hive %s (its container, volume and network)? A backup is made first. [y/N] ' "$name"
    read -r answer; [[ "$answer" =~ ^[yY] ]] || die "kept."
  fi
  cmd_backup "$name"
  local ports; ports="$($DOCKER inspect -f '{{index .Config.Labels "doca.hive.models"}}' "$name")"
  $DOCKER rm -f "$name" >/dev/null
  $DOCKER volume rm "$name-data" >/dev/null 2>&1 || true
  $DOCKER network rm "$name-net" >/dev/null 2>&1 || true
  firewall del "$(bridge_of "$name")" "$ports"
  say "removed $name; its backup stays at $BACKUP_FILE"
}

# The new image on the same volume (deploy/README.md, "Updating a hive"). The hive's own update channel says what is
# newer and which image (bin/doca-update.js latest, verified against the release key); its work is held: it is asked
# to stop once nothing runs (bin/doca-update.js hold — never cut), a backup of its volume is made, the new image starts
# with the options it was made with, and if it does not answer the old image starts again on the same volume.
cmd_update() {   # name [--image IMAGE] [--timeout SECONDS]
  need_hive "$1"
  local name="$1"; shift
  local image="" timeout=21600 old args info digest
  while [ $# -gt 0 ]; do
    case "$1" in
      --image) image="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) die "unknown option $1 (hive.sh help)." ;;
    esac
  done
  running "$name" || die "$name is not running: start it first, so it can say what it runs and hold its work."
  if [ -z "$image" ]; then
    info="$($DOCKER exec "$name" node bin/doca-update.js latest 2>/dev/null || true)"
    image="$(printf '%s' "$info" | sed -n 's/.*"image":"\([^"]*\)".*/\1/p')"
    digest="$(printf '%s' "$info" | sed -n 's/.*"imageDigest":"\(sha256:[0-9a-f]*\)".*/\1/p')"
    [ -n "$image" ] || die "$name's update channel names no image (${info:-no answer}): pass --image IMAGE."
    [ -n "$digest" ] && image="${image%%:*}@$digest"   # the digest the signed release names: the bytes, not a tag
  fi
  old="$($DOCKER inspect -f '{{.Config.Image}}' "$name")"
  args="$($DOCKER inspect -f '{{index .Config.Labels "doca.hive.args"}}' "$name")"
  if [ -z "$args" ]; then   # a hive made before the label: its port and address, the defaults for the rest
    local p; p="$($DOCKER port "$name" | sed -n 's/^[0-9]*\/tcp -> //p' | sort -t: -k2 -n | head -1)"
    args="--port ${p##*:} --bind ${p%:*}"
  fi
  $DOCKER image inspect "$image" >/dev/null 2>&1 || $DOCKER pull "$image" >/dev/null || die "the image $image could not be pulled."
  say "updating $name: $old → $image"
  $DOCKER update --restart no "$name" >/dev/null
  say "asking $name to stop once nothing runs (running work is never cut)…"
  if ! $DOCKER exec "$name" node bin/doca-update.js hold --timeout "$timeout"; then
    $DOCKER exec "$name" node bin/doca-update.js release >/dev/null 2>&1 || true
    $DOCKER update --restart unless-stopped "$name" >/dev/null
    die "$name is still working after ${timeout}s; nothing was changed. Try again later, or with a longer --timeout."
  fi
  $DOCKER wait "$name" >/dev/null 2>&1 || true
  cmd_backup "$name"   # the way back for the data, before a new version touches it (CONSTITUTION S9); it is stopped already
  $DOCKER rm "$name" >/dev/null
  # shellcheck disable=SC2086 — args is the hive's own options, words by design
  if (IMAGE="$image" RESTORING=1 create "$name" $args); then
    say "updated $name to $image; its backup from before is $BACKUP_FILE"
  else
    warn "$image did not answer: starting $old again on the same volume."
    $DOCKER rm -f "$name" >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    (IMAGE="$old" RESTORING=1 create "$name" $args) || die "$old did not start either: restore $BACKUP_FILE (hive.sh restore)."
    die "the update did not hold; $name runs $old again. Its log: docker logs $name"
  fi
}

case "${1:-help}" in
  new)     shift; check_name "${1:-}"; name="$1"; shift
           $DOCKER inspect "$name" >/dev/null 2>&1 && die "$name exists (hive.sh list)."
           has_volume "$name" && die "the volume $name-data exists: restore it (hive.sh restore) or remove that hive first."
           create "$name" "$@" ;;
  list)    cmd_list ;;
  start)   need_hive "${2:-}"; $DOCKER start "$2" >/dev/null; wait_healthy "$2"; say "started $2" ;;
  stop)    need_hive "${2:-}"; $DOCKER stop -t 30 "$2" >/dev/null; say "stopped $2" ;;
  code)    need_hive "${2:-}"; port="$($DOCKER port "$2" | sed -n 's/^[0-9]*\/tcp -> //p' | sort -t: -k2 -n | head -1)"; setup_code "$2" "${port%:*}" "${port##*:}" ;;
  backup)  shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  remove)  shift; cmd_remove "$@" ;;
  update)  shift; cmd_update "$@" ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac

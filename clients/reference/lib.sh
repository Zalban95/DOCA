#!/usr/bin/env bash
# Shared helpers for the reference clients. Needs: bash, curl, jq.
#
#   DOCA_URL    base URL, default https://localhost:4242
#   DOCA_TOKEN  bearer token for this device
#   DOCA_CLIENT optional X-Doca-Client header (e.g. "watch-sh/1.0")

DOCA_URL="${DOCA_URL:-https://localhost:4242}"
DOCA_CLIENT="${DOCA_CLIENT:-doca-ref-client/1.0}"
CURL=(curl -sk --connect-timeout 5 -H "X-Doca-Client: $DOCA_CLIENT")

die() { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
need curl; need jq

# api METHOD PATH [JSON_BODY]  → prints body, sets API_STATUS
api() {
  local method="$1" path="$2" body="${3:-}" out
  local args=(-X "$method" -H "Accept: application/json" -w $'\n%{http_code}')
  [[ -n "${DOCA_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $DOCA_TOKEN")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" --data "$body")
  out="$("${CURL[@]}" "${args[@]}" "$DOCA_URL$path")"
  API_STATUS="${out##*$'\n'}"
  [[ -n "${API_STATUS_FILE:-}" ]] && printf '%s' "$API_STATUS" > "$API_STATUS_FILE"   # survives subshells/pipes
  printf '%s\n' "${out%$'\n'*}"
}

# api_bin PATH OUTFILE → downloads binary (image), prints "status content-type bytes"
api_bin() {
  "${CURL[@]}" -H "Authorization: Bearer $DOCA_TOKEN" -o "$2" -w '%{http_code} %{content_type} %{size_download}\n' "$DOCA_URL$1"
}

# api_upload PATH FIELD FILE MIME [extra -F args...]
api_upload() {
  local path="$1" field="$2" file="$3" mime="$4"; shift 4
  "${CURL[@]}" -H "Authorization: Bearer $DOCA_TOKEN" -F "$field=@$file;type=$mime" "$@" "$DOCA_URL$path"
}

# stream [SINCE] → prints one JSON envelope per line (SSE → NDJSON), until killed
stream() {
  local since="${1:-0}"
  "${CURL[@]}" -N -H "Authorization: Bearer $DOCA_TOKEN" -H "Accept: text/event-stream" "$DOCA_URL/api/v1/events?since=$since" \
    | while IFS= read -r line; do
        case "$line" in
          data:*) printf '%s\n' "${line#data: }";;
        esac
      done
}

uuid() { cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N; }

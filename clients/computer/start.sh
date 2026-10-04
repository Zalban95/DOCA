#!/bin/bash
# Bring the desktop up, then the control server. Everything but the control server is background.
set -u
mkdir -p "$WORKDIR"
Xvfb "$DISPLAY" -screen 0 "${SCREEN}x24" -nolisten tcp &
for i in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.1; done
# A quiet window manager: an empty config, so it shows no first-run message window.
mkdir -p /home/agent/.fluxbox && touch /home/agent/.fluxbox/init /home/agent/.fluxbox/menu /home/agent/.fluxbox/keys
fluxbox -no-toolbar >/dev/null 2>&1 &
# VNC for a person to watch and take over: a password the hub chose, reachable through noVNC on 6080.
x11vnc -storepasswd "${VNC_PASSWORD:-doca}" /home/agent/.vncpass >/dev/null 2>&1
x11vnc -display "$DISPLAY" -rfbauth /home/agent/.vncpass -forever -shared -rfbport 5900 -localhost -quiet >/dev/null 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
# The container is the sandbox, so Chromium's own (which needs privileges a container lacks) is off.
chromium --no-sandbox --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage \
  --remote-debugging-port="$CDP_PORT" --remote-debugging-address=127.0.0.1 \
  --user-data-dir=/home/agent/.chromium --window-position=0,0 --window-size="${SCREEN/x/,}" about:blank >/dev/null 2>&1 &
exec node /opt/doca-computer/agent.js

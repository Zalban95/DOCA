# A computer for an agent (docs/design/hive.md §3.2): a Linux desktop in a container — a virtual screen,
# a window manager, Chromium driven over CDP, ffmpeg to record, xdotool for mouse and keys, VNC/noVNC so a
# person can watch and take over — and the control server the hub talks to over MCP (agent.js).
# Docker runs Linux containers on Linux, Windows and macOS hosts alike.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb fluxbox x11vnc novnc websockify ffmpeg xdotool \
      fonts-dejavu-core fonts-noto-color-emoji ca-certificates curl git python3 procps \
    && rm -rf /var/lib/apt/lists/* \
    # fluxbox asks fbsetbg for a wallpaper and, finding no setter, leaves an xmessage window on the screen
    && ln -sf /bin/true /usr/bin/fbsetbg
RUN useradd -m -s /bin/bash agent
COPY agent.js tools.js cdp.js start.sh /opt/doca-computer/
RUN chmod +x /opt/doca-computer/start.sh
USER agent
WORKDIR /home/agent
ENV DISPLAY=:1 SCREEN=1280x800 PORT=8765 CDP_PORT=9222 WORKDIR=/home/agent/work
EXPOSE 8765 6080
CMD ["/opt/doca-computer/start.sh"]

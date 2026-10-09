# syntax=docker/dockerfile:1
# A hive's image (deploy/README.md): DOCA in the hosted profile, its data in one volume at /data.
#
#   docker build -t doca-hive .            deploy/hive.sh new <name> makes a hive from it
#
# What is in it is the code that runs: no tests, no history, no notes (.dockerignore). It has no shell, no git and no
# package manager, and runs as an unprivileged user that cannot change the code: DOCA's hosted profile is what keeps
# people and agents out of /app (modules/hosted.js), and this is the floor under it.

FROM node:22-slim AS build
# node-pty is compiled here (an optional dependency: the Terminal is absent in a hosted hive, but the image is the
# same DOCA); tini is taken from here too.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force \
 && cd node_modules/node-pty && rm -rf prebuilds deps src third_party build/Release/obj.target build/Release/.deps   # built here: the rest is other OSes' and its sources
COPY . .

FROM node:22-slim
COPY --from=build /usr/bin/tini /usr/bin/tini
COPY --from=build --chown=root:root /app /app
# One volume holds everything a hive keeps; the paths below put every part of DOCA's state in it, and the environment
# wins over a saved path (modules/paths.js), so a person cannot move the workspace onto the code.
ENV NODE_ENV=production \
    DOCA_PROFILE=hosted \
    DOCA_HOME=/data \
    DOCA_DATA_DIR=/data/doca \
    DOCA_BACKUP_DIR=/data/backups \
    HOME=/data/home \
    WORKSPACE_DIR=/data/workspace \
    ATTACHMENTS_DIR=/data/workspace/attachments \
    AGENTS_DIR=/data/workspace/agents \
    SKILLS_DIR=/data/workspace/skills \
    DOCA_LISTEN=lan \
    PORT=4242
# The data folder is the unprivileged user's; the code is root's and read-only to it. Then what could run something
# other than node goes: npm and its kin, the shells, perl and awk (each of which can start a program of its own).
RUN mkdir -p /data/home /data/workspace \
 && chown -R node:node /data \
 && chmod -R a-w /app \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && rm -f /usr/bin/perl* /usr/bin/mawk /usr/bin/awk /etc/alternatives/awk \
          /usr/bin/bash /usr/bin/rbash /usr/bin/dash /usr/bin/sh /bin/sh /bin/bash /bin/dash /bin/rbash
USER node
WORKDIR /app
VOLUME /data
EXPOSE 4242
# The panel answers its unauthenticated product name when it is up (self-signed HTTPS, or HTTP when no certificate).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PORT||4242,o={host:'127.0.0.1',port:p,path:'/api/branding',rejectUnauthorized:false,timeout:4000};const go=m=>m.get(o,r=>process.exit(r.statusCode===200?0:1)).on('error',()=>m===require('https')?go(require('http')):process.exit(1));go(require('https'))"]
# tini is PID 1 and node its one child, so a Restart in the panel exits and the container's restart policy starts it
# again (modules/self-restart.js).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

---
name: truenas
description: Look after the person's TrueNAS — pools and their health, datasets and space, disks, snapshots, apps and alerts — with TrueNAS's own command line over SSH. Use when the person asks about their NAS, its space, a pool's health, a failed disk or an alert.
triggers: [truenas, nas, zfs pool, scale, freenas]
---

# TrueNAS

TrueNAS's REST API was deprecated in 25.04 and goes in 26; its API is now JSON-RPC over a WebSocket, which DOCA's API
services do not speak. The way that works on every version is **`midclt call`** — the same API, from TrueNAS's own
shell — over SSH (`reach-another-machine` says how SSH is set up between machines).

## Connecting it (once, with the person)

1. In TrueNAS: **System → Services → SSH** on; a user for DOCA (**Credentials → Users**) with an SSH public key — the
   hub's own (`~/.ssh/id_ed25519.pub` on the hub) — and, for anything beyond reading, the rights it needs.
2. Check: `ssh <user>@<truenas> midclt call system.info`. Keep the host and user in memory.

## Reading

Each answers JSON; summarise it, never paste it whole.
- Health and alerts: `midclt call alert.list` (say the CRITICAL and WARNING ones by name), `midclt call system.info`.
- Pools: `midclt call pool.query` — `name`, `status`, `healthy`; space with `zpool list` or `midclt call pool.dataset.query '[["type","=","FILESYSTEM"]]'`.
- Disks: `midclt call disk.query`; a disk's SMART result: `midclt call disk.smart_attributes <name>` (25.x) or `smartctl -a /dev/<disk>`.
- Snapshots: `midclt call zfs.snapshot.query '[]' '{"count": true}'`; apps: `midclt call app.query`.

## Changing

Anything that changes the NAS — a snapshot, a scrub, an app's start or stop — says what and asks first. Never delete a
dataset or a snapshot, export or destroy a pool from here: say where in TrueNAS's own pages the person does it.

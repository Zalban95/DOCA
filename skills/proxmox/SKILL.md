---
name: proxmox
description: Look after the person's Proxmox VE host or cluster — its nodes, virtual machines and containers, their state, and starting or shutting them down — through its API. Use when the person asks what runs on Proxmox, whether a VM is up, or to start, shut down or stop one.
services: [proxmox]
triggers: [proxmox, pve, proxmox ve, lxc]
---

# Proxmox VE

Proxmox VE answers on `https://<its host>:8006/api2/json`. It is the API service `proxmox`: `service describe proxmox`
lists its actions.

## Connecting it (once, with the person)

1. In Proxmox: **Datacenter → Permissions → API Tokens → Add** — a token for a user (root@pam, or better a user of its
   own with the role PVEVMUser or PVEAuditor for looking only). Untick *Privilege Separation* or give the token its own
   permissions. Proxmox shows the secret once.
2. In **Field → Connectors → API services**, type `proxmox` in "Add a service": the ready-made Proxmox VE fills the
   actions; set its address to the host's (`https://pve.lan:8006/api2/json`, the name it really has) and paste the
   token as `USER@REALM!TOKENID=SECRET` (root@pam!doca=…). Never ask for the secret in the chat.
3. **Its certificate.** Proxmox makes its own (self-signed), which the hub refuses until the person trusts that exact
   certificate: **Field → Connectors → Certificates you trust**, its address, "Look at its certificate", compare the
   fingerprint with Proxmox's own (the node's System → Certificates), Trust — with their password. Or give Proxmox a
   trusted one (its ACME, Let's Encrypt). Say this plainly when a call fails with a certificate error.

## Using it

- What runs: `listResources` (everything, one call) — then name VMs and containers by their `name`, with their node.
- A VM's state: `vmStatus {node, vmid}`; a container's: `containerStatus`.
- Starting is harmless: `vmStart` / `containerStart` when asked.
- **Shutting down asks first**: `vmShutdown` lets the system close cleanly; `vmStop` is pulling the plug — only when
  the person says so after a shutdown did not work. Name what will go down before doing it.

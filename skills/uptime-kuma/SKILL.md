---
name: uptime-kuma
description: Read what the person's Uptime Kuma watches — which monitors are up or down, their response times and certificates — from its metrics or a published status page. Use when the person asks whether their services are up, what went down, or how a site is doing.
services: [uptime-kuma]
triggers: [uptime kuma, uptime-kuma, is it up, monitors, status page]
---

# Uptime Kuma

Uptime Kuma (usually on port 3001) has no supported API for changing monitors — its own pages talk to it over a
socket — so DOCA reads, it does not edit. It is the API service `uptime-kuma`: `service describe uptime-kuma`.

## Connecting it (once, with the person)

1. In Uptime Kuma: **Settings → API Keys → Add API Key**. It shows the key once (`uk2_…`).
2. In **Field → Connectors → API services**, type `uptime-kuma` in "Add a service": set its address
   (`http://<its host>:3001`) and paste `doca:<the key>` — sent as a Basic sign-in, the name before the colon ignored.

## Using it

- **Everything at once**: `metrics` — Prometheus text. Read the lines `monitor_status{monitor_name="…"} N`:
  1 up, 0 down, 2 pending, 3 maintenance; `monitor_response_time` in ms; `monitor_cert_days_remaining`. Say the down
  ones first, by name, then "everything else is up".
- **A published status page** needs no key: `statusPage {slug}` and `statusPageBeats {slug}`.
- Adding or pausing a monitor is done in Uptime Kuma itself: say where (its Dashboard → Add New Monitor).

---
name: hi3d
description: Make 3D models from pictures with hi3d.ai (Hitem3D) — a GLB, STL, OBJ, FBX, USDZ or 3MF from one image or up to four views — and show them in the chat. Use when the person asks for a 3D model, a printable object or an asset from a photo or a drawing.
---

# 3D models from pictures, with hi3d.ai

hi3d.ai (Hitem3D, docs.hi3d.ai) turns one picture — or two to four views of the same object, front first — into a 3D
model. It runs on the person's own credits. Everything here is DOCA's ordinary tools: no code for this service.

## Connecting it (once, with the person)

The person creates an API client on hi3d.ai (its developer page) and gets a **client id** and a **client secret**.
They add them in **Field → Connectors → Keys for services**:

- name `hi3d`, address `https://api.hitem3d.ai`
- where it goes: **id:secret, traded for a token**; token address `https://api.hitem3d.ai/open-api/v1/auth/token`
- the key: `client_id:client_secret` (joined by a colon)

The hub trades them for a token itself and renews it; you never see either. If `http_fetch` with `key: "hi3d"`
says there is no such key, tell the person these four lines — never ask them to paste the secret into the chat.

## Making a model

1. **The picture** must be a file: an attachment the person sent, a file in the workspace, or one you made. PNG,
   JPEG or WEBP, under 20 MB; a plain background helps (or ask hi3d to remove it with `rmbg: 1`).
2. **Submit** — one request, an upload:
   `http_fetch {url: "https://api.hitem3d.ai/open-api/v1/submit-task", key: "hi3d",
   form: {request_type: "3", model: "hi3dv3.0", format: "2"}, files: {images: "<the picture>"}}`
   - `request_type`: 1 geometry only, 2 texture only (needs a mesh), 3 both — 3 unless asked otherwise.
   - `format`: 1 obj, 2 glb, 3 stl, 4 fbx, 5 usdz, 6 3mf. **GLB** to look at it here; **STL** or **3MF** to print it.
   - More views: `files: {multi_images: …}` for each of up to four views (front first) instead of `images`.
   - Optional: `resolution` (v3.0: `2048quality` or `2048master`), `face` (100000–5000000 polygons).
   The answer carries `data.task_id`. A model takes minutes and spends credits: say so once, then wait.
3. **Wait for it** — every 15–30 s, not faster:
   `http_fetch {url: "https://api.hitem3d.ai/open-api/v1/query-task?task_id=<id>", key: "hi3d"}`
   `state` goes `created` → `queueing` → `processing` → `success` (or `failed`, with a reason to tell the person).
4. **Keep it** — on `success`, `url` is the model, valid for one hour: download it straight away, without the key
   (it is a plain link): `http_fetch {url: "<url>", save_as: "<a short name>.glb"}`. `cover_url` is a preview
   picture, worth keeping too (`save_as: "<name>-cover.png"`).
5. **Show it** — `show_media` with the saved file: the panel draws a 3D model in the chat, turning, with full screen
   (GLB, GLTF, STL, OBJ, FBX, PLY, 3MF; USDZ is offered as a download, and as AR on an iPhone).

## Good to know

- Credits: `http_fetch {url: "https://api.hitem3d.ai/open-api/v1/balance", key: "hi3d"}` — `data.totalBalance` is what is left; ask before a
  large batch.
- An error `40010000` means the id or secret is wrong: the person fixes it in Keys for services.
- In a call, say in a sentence that it is on its way and carry on; the model arrives in the chat when it is ready.

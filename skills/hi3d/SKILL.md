---
name: hi3d
description: Make 3D models from pictures with hi3d.ai (Hitem3D) — a GLB, STL, OBJ, FBX, USDZ or 3MF from one image or up to four views — and show them in the chat. Use when the person asks for a 3D model, a printable object or an asset from a photo or a drawing.
services: [hi3d]
---

# 3D models from pictures, with hi3d.ai

hi3d.ai (Hitem3D, docs.hi3d.ai) turns one picture — or two to four views of the same object, front first — into a 3D
model. It runs on the person's own credits. It is the API service `hi3d`: `service describe hi3d` lists its actions.

## Connecting it (once, with the person)

In **Field → Connectors → API services**, the person types `hi3d` in the first box and picks the ready-made hi3d.ai:
everything is filled but the key. The key is the **Access Key** and the **Secret Key** from hi3d.ai's developer page,
joined by a colon (`AccessKey:SecretKey`, no spaces); the hub trades them for a token itself. If `service list` does
not show `hi3d`, or says its key is not pasted, tell the person that — never ask them to paste the secret into the chat.

## Making a model

1. **The picture** must be a file: an attachment the person sent, a file in the workspace, or one you made. PNG,
   JPEG or WEBP, under 20 MB; a plain background helps (hi3d removes it by default, `rmbg: 1`).
2. **Submit** — say once that it takes minutes and spends credits, then:
   `service {action: "call", service: "hi3d", operation: "submitTask", params: {request_type: 3, model: "hi3dv3.0", format: 2},
   files: {images: "<the picture>"}, save_as: "<a short name>"}`
   - `request_type`: 1 geometry only, 2 texture only (needs a mesh), 3 both — 3 unless asked otherwise.
   - `format`: 1 obj, 2 glb, 3 stl, 4 fbx, 5 usdz, 6 3mf. **GLB** to look at it here; **STL** or **3MF** to print it.
   - More views: `files: {multi_images: …}` (up to four, front first) instead of `images`.
   - Optional: `resolution` (v3.0: `2048quality` or `2048master`), `face` (100000–5000000 polygons).
3. **Do not poll.** The hub asks after the task every 20 s, keeps the model and its preview picture as attachments
   when it is done (the links are valid for one hour; the hub fetches them at once), and tells this conversation.
   Carry on meanwhile; in a call, say it is on its way.
4. **Show it** — when told it is done, `show_media` with the kept file: the panel draws a 3D model in the chat,
   turning, with full screen (GLB, GLTF, STL, OBJ, FBX, PLY, 3MF; USDZ is offered as a download, and as AR on an iPhone).

## Good to know

- Credits: `service {action: "call", service: "hi3d", operation: "getBalance"}` — `data.totalBalance` is what is left;
  ask before a large batch.
- A failed task (`generate failed`) refunds its credits; say so and ask before trying again.
- An error `40010000` means the id or secret is wrong: the person fixes it with Edit on the hi3d row.
- After a restart the hub says which jobs it stopped following; `follow` with the task id takes one up again.

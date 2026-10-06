---
name: photos-and-files
description: Work with a photo, a document or any file the person sent or asked about — look at it, convert it, resize it, put it somewhere, send it to a device. Use when a message carries an attachment or names a file.
---

# Photos and files

1. An attachment arrives as a **path** (the message says where). Read text with `read_file`; for anything else use
   the tools the machine has through `shell` (`ffmpeg`, `convert`/`magick`, `pdftotext`) — propose a missing one with
   `install_propose {kind: "tool"}`.
2. **Show** a result with `show_media` (pictures, video, audio, documents, 3D models) — never with markdown.
3. **Move or copy** with `shell`, and say where it went. A file for another machine: that machine's own tools (see
   `reach-another-machine`).
4. **Send** to a device with `tell_device` and its picture, or put it on the phone through the phone's own tools when
   it lends them (`doca_clients` says which device lends hands).
5. A conversion the person will ask for again (a size, a format): offer once to keep it, `recipe` save_last.

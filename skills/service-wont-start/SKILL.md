---
name: service-wont-start
description: Find out why an inference service (whisper, kokoro, ComfyUI, vLLM, SD WebUI, Roboflow) or a container does not start or does not answer, and fix it or say exactly what is needed. Use when a service shows restarting or exited, or a feature that needs it fails.
---

# A service that will not start

1. **Look**: `system_status` (is the container up, restarting, exited?) and `shell` with `docker logs --tail 80 <name>`
   (or `podman`). Read the last lines for the cause.
2. **Name the cause** — the common ones:
   - a CUDA or PyTorch too old for the GPU ("no kernel image is available"): the image needs a newer build;
   - out of memory (GPU or RAM): another model holds it — `system_status` says which;
   - no GPU in Docker ("could not select device driver"): the NVIDIA Container Toolkit (`install_propose
     {kind: "tool", id: "nvidia-ctk"}`);
   - a port already taken: what holds it (`ss -ltnp` / `Get-NetTCPConnection`);
   - a missing model or checkpoint (ComfyUI without one serves and generates nothing).
3. **Fix** only through the panel's own installer: `install_propose {kind: "service", id}` reinstalls with the right
   image, ports and mounts — never a hand-written `docker run`.
4. Say what you found in one or two lines and what the person has to do, if anything. Keep the cause in memory if it
   is about this machine (`memory_write`), so the next time starts there.

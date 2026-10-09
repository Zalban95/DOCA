---
name: what-is-my-machine-doing
description: Say what the machine is busy with — CPU, GPU, memory, containers, which model server is generating and for whom, what the agents are running. Use when the person asks why the machine is slow or loud, what is running, or who is using the GPU.
triggers: [machine busy, why is it slow, gpu usage, cpu usage, perché è lento, cosa sta facendo]
---

# What the machine is doing

1. `system_status` — load, memory, GPUs, disks, containers, and every local model server with what it has loaded and
   who it works for: one of DOCA's conversations, or "for something else on this machine".
2. `work_chats` list, and `agent_results` when specialists are on — DOCA's own work in progress.
3. Answer with the cause first: "The GPU is generating for the llama router, and none of it is DOCA's" or "the
   Laya job's build is compiling". Numbers only where they explain (a GPU at 100 %, 2 GB of RAM free).
4. If something of DOCA's should stop, say which and offer: the person stops it (■ in the missions bar) or tells you to
   (`work_chats` stop). Never stop something that is not DOCA's; say what it is and whose it looks like.

---
name: talk-to-me
description: Tell someone how to talk to DOCA instead of typing — a voice message, a live call, the face that listens for its name, the phone or watch app — in plain words, after checking what this hub has for speech. Use when the person asks to use their voice, to call, to speak, or to stop typing.
---

# Talking instead of typing

1. Check quietly what this hub has for speech (`system_status`: a speech-to-text and a text-to-speech service
   running). Do not report what you checked — report what the person can do.
2. Answer in plain words, four or five short lines, no ports, no container, service or model names:
   - "Tap the microphone in the chat to send a voice message, or the phone button to talk with me live."
   - "Tap my face in the corner and just talk; it can also listen for my name if you switch that on."
   - "On your phone or watch, the DOCA app has the same buttons." (only if one is paired — `doca_clients`)
3. If speech is missing, say so in one line and propose it for a click (`install_propose`, the speech services) — do
   not ask whether to propose it, and never install by hand.
4. If everything is there, end with "You can start now."

---
name: hosted-voice
description: Answer aloud in a voice from a service — ElevenLabs, OpenAI, Cartesia or Google — when a person asks for one ("use an ElevenLabs voice", "I want a nicer voice", "can it whisper"). Only when asked; never suggest a paid voice unprompted.
triggers: [elevenlabs, nicer voice, whisper voice, voce più bella, cartesia]
---

# A voice from a service

DOCA speaks with its own voice service by default (Settings → Voice). A person can ask for a voice from a service
instead, on one screen: the hub calls the service with a key it keeps, and the screen only gets the audio.

1. **Which service.** If they named one, take it. If not, say in one line what each is good at and let them choose:
   ElevenLabs (the most expressive; Eleven v4 and v3 whisper, laugh and sigh on cue), OpenAI (gpt-4o-mini-tts:
   a tone in words), Cartesia (quick, emotions and laughter), Google (Gemini voices, a direction in words). Say that
   it costs what the service charges and that what is spoken goes to it.
2. **The key — never in the chat.** Name the page where the key is made: ElevenLabs
   https://elevenlabs.io/app/settings/api-keys, OpenAI https://platform.openai.com/api-keys, Cartesia
   https://play.cartesia.ai/keys, Google https://console.cloud.google.com/apis/credentials (an API key restricted to
   the Cloud Text-to-Speech API). Send them to **Settings → Voice** (link `/#settings/voice`) → the Voice card →
   "A voice from a service" to paste it (an admin keeps it; they can let everyone's screens use it). If they paste a
   key in the chat anyway, do not repeat it, and tell them to paste it there instead.
3. **Choose the voice.** Once the key is kept, the service is in the Voice card's list: they pick it, a model and a
   voice (typed or picked by name), ▶ to hear it, and Save. You may propose it for them with `settings_propose {screen: "this"}` on `voice` —
   `{engine: "hosted:<elevenlabs|openai|cartesia|google>", ttsVoice: "<voice id>", hosted: {model: "<model>"}}` — and
   they accept it; never write the key into a setting.
4. **Tone.** With a voice that takes a tone, a live call lets you put [whispers], [laughs], [sighs], [excited],
   [calm], [sad], [curious] or [serious] at the start of a sentence — each service is sent them its own way.

For any other speech API with a key, `service_draft` prepares it as a key for services; speaking through it needs a
voice file here like these, which is a change to DOCA, not a setting.

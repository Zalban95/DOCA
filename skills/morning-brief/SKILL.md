---
name: morning-brief
description: Brief the person on their day — weather, calendar, what is waiting for them, what the agents did overnight. Use when they say good morning, ask "what's my day", or ask for a brief or a summary of today.
triggers: [good morning, "what's my day", brief me, buongiorno, la mia giornata]
---

# A morning brief

1. `today` — the weather and the days ahead, today's plan from their calendar, and what is waiting for them.
2. `work_chats` list (and `agent_results` when specialists are on) — what finished or failed since yesterday evening.
3. Answer in at most six short lines, most important first: the first appointment and its time, anything that needs
   them (a question, a proposal), the weather only when it changes a plan (rain, heat, a storm), work that finished.
   No headings. On a watch or in a call: three spoken sentences.
4. If they ask for it every day, offer a schedule (`schedule`, every weekday at the hour they say) — it waits for
   them to switch it on.
5. The first time this works the way they like, offer once: `recipe` save_last.

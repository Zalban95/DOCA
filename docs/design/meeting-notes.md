# Meeting notes: what was said, kept and found again

Asked 2026-10-12, pointing at Google AI Edge Foresight (released 2026-10-06: a free macOS app that listens to a meeting
on the device, turns a person's shorthand into full notes from the transcript, answers questions spoken aloud from
folders and the calendar the person pointed it at — EmbeddingGemma 2 and Gemma 4, nothing in the cloud). DOCA already
has every part of that: meetings with a chat (meetings.md), the hub's speech-to-text, the Library on EmbeddingGemma 2
(docs/experiments/library.md), the person's calendars (accounts/), models of the person's choosing. This is how they
join, under the constitution: consent before anything is heard (S-rules), mechanical first (V12), local by default
(P4), the person's own model (P1), nothing an agent posts in what is shown as the record (visibility is mechanical).

## The experience

1. **Notes are asked for, never assumed.** In a meeting, *Take notes* (the meeting's bar) asks everyone in the room:
   "Sam wants to keep notes of this meeting: what you say is transcribed on the hub. [Allow] [Not me]". A person who
   says Not me is never transcribed — their audio is not sent to the transcriber at all — and the notes say "2 of 3
   agreed to be noted". A person who joins later is asked as they join. Stopping notes is one click, for anyone who
   started them; leaving the meeting withdraws one's own consent for the rest of it.
2. **Each person's own microphone.** What is transcribed is what each consenting page sends of its own microphone —
   never the mixed room — so a line is always a person's, named by their account (`meetings/notes/hear.js`). An
   in-person meeting is one page (a phone on the table, a desk's microphone): its speaker is "the room", said so.
3. **Shorthand becomes notes.** The notes page (beside the meeting's chat) is a plain document the person types into
   as they like — "budget q4 → ask Marco", "deadline 30th?" — and *Write it up* turns each line into a sentence from the
   transcript around it (the person's model, `transport.ask`, no tools; the line, the minutes before and after it, the
   meeting's title and people). What the person typed stays visible beside what was written from it; nothing is
   replaced silently.
4. **A question said aloud gets an answer on the page.** A sentence that asks something ("what did we decide about
   the venue last time?") is found by rules first (a question mark in the transcript, the words of a question, in the
   five languages calls know — mechanical, no model), then answered from the Library and earlier meetings' notes
   (search by meaning, `library/search.js`, as the person — only what they may open) and their calendar; the answer
   is a card on the person's own page, with its sources, never said into the meeting.
5. **The record.** When the meeting ends: the transcript (who, when, words), the notes as written up, decisions and
   actions found in them, the chat — one markdown file per meeting, in the meeting's folder (`DATA_DIR/meetings/<id>/`),
   readable by its people only, indexed by the Library so "what did Sara say about the venue" finds it later. An action
   with a person's name and a date can become a reminder for that person — proposed on the notes page, made only with
   a click (S1: the agent proposes).
6. **Recall.** The agent's `recall_conversations` and the Library find past meetings by meaning; the Meetings page
   lists each with its notes; a device reads them through the meetings' `/api/v1` routes as its person.

## How it is built

| Part | Where | Notes |
|---|---|---|
| Consent | `meetings/notes/consent.js` | per meeting, per person; asked on the live feed; a refusal is a hard stop for that person's audio |
| Hearing | `meetings/notes/hear.js`, `public/js/meet/notes-mic.js` | each consenting page sends its own microphone in utterances (the call engine's VAD, `chat-call-mic.js`), the hub's STT (`stt.js`, the call's language rules), lines kept in memory and written at the end |
| The notes page | `meetings/notes/store.js`, `public/js/meet/notes.js` | the person's text, the written-up lines beside it, saved as they type |
| Write it up | `meetings/notes/write.js` | one `transport.ask` per line, no tools, the person's model; marked "written from the transcript" |
| Questions | `meetings/notes/questions.js` | rules find them (V12), then Library search + calendar; a card on the asker's page only |
| The record | `meetings/notes/record.js` | markdown, the meeting's folder, `library` indexes it when the folder is one the Library reads (`meetings.notesFolder`) |
| Settings | `meetings.notes` (off / ask / on for meetings I start), `meetings.notesKeepDays` | declared, never proposable |

**What it never does:** transcribe someone who did not agree; send audio or words to a service the owner did not
choose (the hub's own STT and the person's model provider); speak into the meeting; write the record with a model (the
transcript and the chat are the record, mechanical; written-up lines are marked as the model's).

## Measured before it ships

A recorded test meeting of three voices (two consenting, one not) in English and Italian: no line of the third voice
in the transcript; each written-up line traceable to its minute; a question spoken aloud answered from a document in
the Library within 5 s; the record found again by a sentence that is not in it.

## Not in this round

The agent as a voice participant (meetings.md "Not yet"); a summary written for people who were not there (a later
experiment, with its own measure); notes for calls outside DOCA (a phone call, another app's meeting) — they need the
client to hear the call, which is the phone's to offer.

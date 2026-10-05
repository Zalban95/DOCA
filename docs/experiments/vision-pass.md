# Experiment: look at a computer's screen with a vision model

**Flag:** `experiments.visionPass` (Settings → Experiments), off by default, and inert until a vision model is set
(`vision.model`). **TODO:** H5.6. **Since:** 2.197.0.

## Hypothesis

A computer's browser is read as numbered elements (`browser_snapshot`), which is exact and cheap — until there are none:
a canvas app, a game, a remote desktop, a picture of a form, a desktop program. Then the agent clicks blind or gives
up. A vision model asked one question about the screen ("where is the Start button?") gives a position to
`desktop_click` and a description to act on, at the cost of one image request when the tree is not enough.

## What happens when it is on

1. Agents that hold a computer hold `computer_look` (it does not exist while the flag is off or no model is set).
2. A call takes the computer's screen as it is (the same screenshot the Computers tab shows), sends it with the question
   to the vision model, and returns its answer: what is visible and where, as x,y pixel coordinates.
3. The answer is a model's reading of a screen other people made, so it reaches the agent framed as outside words, and
   the next action after it is asked about again in a watched conversation.

## Measured

`npm run experiment -- vision-pass`, with `vision.model` set on the machine running it: synthetic screens are drawn
with buttons at known places, and the model is asked for each one's centre. Reported: how many were found within 25 px,
the mean error, and the seconds per question.

| Date | Vision model | Found within 25 px | Mean error | Seconds per question |
|---|---|---|---|---|
| — | — | not measured yet: needs a vision model on the machine running it (e.g. `ollama pull qwen2.5vl`) | — | — |

## Cost

One image request per call (a 1280×800 PNG is about 1,000–1,500 image tokens on hosted models); nothing when the flag is
off. A local model needs its own memory — a 7B vision model takes 6–8 GB of a GPU.

## Risks

- **Coordinates that are close but wrong**: a click a few pixels off lands on the neighbour. The measure above is the
  answer to "how often"; `browser_snapshot` stays the first choice wherever it numbers the element.
- **Text on the screen steering the model**: it is told not to follow it, and its answer is framed for the agent.
- **What leaves the machine**: with a hosted model, the screenshot does. Use a local model to keep it here.

## Rollback

Switch the flag off: the tool is gone from every agent's list at its next step.

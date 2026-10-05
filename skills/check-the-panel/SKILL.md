---
name: check-the-panel
description: Check DOCA's own panel the way a person uses it — every tab and Settings section in a real browser, desktop and phone sizes, errors and screenshots — after a change or when something "does not work".
---

# Checking the panel in a browser

A green test suite says nothing about what a person sees. Use a browser — an agent's computer (`computer`, then its `browser_*` tools), or Playwright on this machine if the `playwright` MCP server is added.

1. **Sign in as a test account**, not the owner's; never change the owner's settings to test.
2. **Every tab** (`nav('<tab>')` in the page, or the bottom bar on a phone), then **every Settings section** (`settingsSubNav('<id>')`). Collect page errors, console errors and every `/api/` answer of 400 or more.
3. **Two sizes:** 1400×900 and 390×844. Phone-only problems are common: things covered by the chat button or the bottom bar, notes cut off, buttons wrapping.
4. **Look at the screenshots**, not only at the error counts: overlaps, raw text where a number belongs (versions, sizes), a button that does nothing, a password prompt where none should be.
5. **Do the thing**, not just look: press the button the person pressed, through the page, and follow what happens (the job's output, the service's state afterwards).

Report what was checked (tabs, sections, sizes), what was found with a screenshot each, and what was not checked.

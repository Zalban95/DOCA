---
name: debug-method
description: Find and fix the cause of a failure by method — reproduce it, narrow it down with evidence, fix the cause with the smallest change, prove it. Attached in Debug mode.
attach-modes: [debug]
triggers: [bug, broken, error, crash, fails, failing, "doesn't work", non funziona, errore, si blocca, è rotto]
---

# Debugging by method

1. **Reproduce it.** Make the failure happen on purpose and show it: the exact command, input and output. A failure you cannot reproduce, you cannot prove fixed — say so and gather what would reproduce it.
2. **Read the evidence.** The full error and stack, the logs around it, what changed recently (`git log`, `git diff`). Note what you expected and what happened instead.
3. **Narrow it down.** Form one hypothesis at a time and test it with evidence — a minimal case, added output, bisecting the input or the history — rather than by reading alone. Write down what each test ruled out.
4. **Fix the cause, not the symptom**, with the smallest change that removes it. A fix that hides the error (a catch, a retry, a default) is not a fix unless the cause is outside your reach — and then say so.
5. **Prove it.** The reproduction now passes, a test holds it, and nothing nearby broke (run the related tests). Remove any temporary output you added.
6. **Say what it was.** One line: the cause, the fix, and how it was proved.

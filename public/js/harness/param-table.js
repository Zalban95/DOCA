/* ═══════════════════════════════════════════════════════
   The built-in harness's parameters as the ⚙ form shows them. Read by
   _harnessParamsHtml() in params.js, which renders a box per row.
   ═══════════════════════════════════════════════════════ */

/**
 * Every parameter of the built-in harness, in one place: what it is called, what
 * it does in plain words, and a range that is actually sensible.
 *
 * The descriptions used to be `title` attributes — present, correct, and
 * invisible unless you had a mouse and knew to hover. This panel is meant to be
 * usable by somebody who did not build it, so they are on screen.
 *
 * The ranges were written for an 8k-context model and had not moved since: 40
 * tool steps, 200 messages of history, 100 memory entries. Against a model with
 * a million-token window those are not limits, they are typos waiting to clamp
 * somebody's saved value back down to the maximum.
 *
 * When you add a parameter to `defaultParams()` in modules/harness/providers.js,
 * add it here too — otherwise it exists, does something, and has no way to be
 * set. That is exactly how `contextWindow` shipped without a box to type it in.
 */
const HARNESS_PARAMS = [
  { key: 'temperature', label: 'Temperature', attrs: 'min="0" max="2" step="0.05"',
    hint: 'How varied the answers are. Around 0.2 for work that should come out the same way twice; '
        + '0.7–1.0 for drafting, naming and ideas.' },

  { key: 'topP', label: 'Top P', attrs: 'min="0" max="1" step="0.05"',
    hint: 'A second, blunter variety control. Leave it at 1 and use Temperature — changing both at once '
        + 'makes the effect of either hard to judge.' },

  { key: 'contextWindow', label: 'Context window', unit: 'tokens', attrs: 'min="0" step="1000"',
    hint: 'How much the model can hold at once: these instructions, the conversation so far and everything '
        + 'its tools returned, tool descriptions and room for the reply. Use the served model\'s actual limit; '
        + 'local servers may be configured below the model\'s maximum. Requests estimated to exceed this '
        + 'are skipped before sending. 0 means unknown and disables this check and the percentages below.' },

  { key: 'maxTokens', label: 'Longest reply', unit: 'tokens', attrs: 'min="0" step="128"',
    hint: 'The most the model may write in one answer. 0 leaves it to the provider. This is a cap on the '
        + 'reply only; this much room is reserved when checking whether a request fits the context window.' },

  { key: 'firstTokenTimeoutMs', label: 'Give up waiting after', unit: 'ms', attrs: 'min="0" step="5000"',
    hint: 'How long to wait for the first word of a reply. This is not a limit on the answer — once the model '
        + 'starts talking it can take as long as it needs. It exists because a provider can accept the request, '
        + 'return OK and then never send anything, which otherwise looks exactly like a frozen panel. '
        + '0 waits forever.' },

  { key: 'failoverAfterMs', label: 'Try the next one after', unit: 'ms', attrs: 'min="0" step="1000"',
    hint: 'Only used when a fallback chain is set below. How long to wait on one entry before moving to the '
        + 'next. Much shorter than the setting above on purpose: waiting the full give-up time on every entry '
        + 'would make a chain slower than having none. The last entry always gets the full give-up time, so '
        + 'how long you wait in total is unchanged.' },

  { key: 'rateLimitRetries', label: 'Retries when rate-limited', attrs: 'min="0" max="20" step="1"',
    hint: 'When a provider answers "too many requests", wait and ask again this many times before giving up. '
        + 'A refused request is not charged, so a retry does not cost twice, and every wait is shown in the chat. '
        + 'A quota or billing refusal is never retried — waiting does not fix an empty account. 0 gives up at once.' },

  { key: 'rateLimitMaxWaitMs', label: 'Longest rate-limit wait', unit: 'ms', attrs: 'min="0" step="1000"',
    hint: 'The most one of those waits may take. The provider usually says how long to wait and that is used; '
        + 'if it asks for longer than this, the turn stops and says so instead of hanging. 0 means 60 seconds.' },

  { key: 'autoTurnsPerJob', label: 'Turns a job may take on its own', attrs: 'min="0" max="500" step="1"',
    hint: 'A work chat keeps working until it reports the job done, failed, blocked or asks a question — or '
        + 'you or the Orchestrator stop it. When a turn ends short of that, the panel starts the next one; '
        + 'when its specialists finish, the panel wakes it. This is how many such turns one job may take '
        + 'before it is reported as stalled instead. 0 switches this off: work then waits to be asked.' },

  { key: 'autoWakesPerHour', label: 'Automatic turns per hour', attrs: 'min="0" max="1000" step="1"',
    hint: 'Every turn the panel starts by itself, across all work chats and the Orchestrator together. Each '
        + 'is a model call you pay for; past this many in an hour the panel waits instead, and says so.' },

  { key: 'tokensPerDay', label: 'Tokens per day', unit: 'tokens', attrs: 'min="0" step="100000"',
    hint: 'A ceiling on every model call together — chats, work chats, specialists, summaries — over the last '
        + '24 hours. Past it, a new turn is refused and says why; one already running is never cut off. '
        + '0 means no ceiling. The "24h … tok" counter in the harness console shows what a day really costs.' },

  { key: 'shellTimeoutSec', label: 'Shell command limit', unit: 's', attrs: 'min="1" max="3600" step="1"',
    hint: 'How long one shell command may run before it is stopped. Longer work — a build, an install, a '
        + 'download — the agent runs in the background instead and checks on it, so this is not a cap on those.' },

  { key: 'maxSteps', label: 'Max tool steps', attrs: 'min="1" max="1000" step="1"',
    hint: 'How many times the agent may use a tool and think again before it has to answer. Each step '
        + 're-sends the whole conversation, so this is the setting that decides what one answer can cost.' },

  { key: 'orchestratorWorkSteps', label: 'Orchestrator work steps', attrs: 'min="0" max="1000" step="1"',
    hint: 'How many steps of real work (commands, writing files, MCP tools, the web) the Orchestrator does in its '
        + 'own turn before the rest of the job moves to a work chat by itself — so the main chat stays free to '
        + 'talk to while work runs. Reading and coordinating do not count. 0 means no limit.' },

  { key: 'historyTurns', label: 'History window', unit: 'messages', attrs: 'min="2" max="5000" step="2"',
    hint: 'How many recent messages are sent word for word. Anything older is represented by the running '
        + 'summary instead — it is not lost, the full transcript is always kept on disk. The turn in progress '
        + 'is always sent whole, even past this number, so a long job never loses the request that started it.' },

  { key: 'summarizeAfter', label: 'Summarise after', unit: 'messages', attrs: 'min="0" max="5000" step="5"',
    hint: 'Once a conversation passes this many messages, the older half is replaced by a short summary. '
        + '0 never summarises, which is fine until a long conversation stops fitting.' },

  { key: 'compactTokens', label: 'Summarise at size', unit: 'tokens', attrs: 'min="0" step="1000"',
    hint: 'Summarise earlier turns once one step\'s prompt reaches this many tokens. It works with no context '
        + 'window set, and it applies even when one is: this and the percentage below are both live, and '
        + 'whichever is reached first wins. With a 1000000 window, 40000 fires at 4% — set this to 0 to let '
        + 'the percentage decide, or raise it. The turn in progress is never summarised, only earlier ones.' },

  { key: 'compactAt', label: 'Summarise at share', unit: '% of window', attrs: 'min="0" max="99" step="5"',
    hint: 'The same summarising, as a share of the context window above — whichever of this and the size '
        + 'above is reached first. Every step re-sends the whole prompt, so a high share of a large window '
        + 'is also a large bill per step. Needs a context window set above.' },

  { key: 'warnAt', label: 'Warn at', unit: '% of window', attrs: 'min="0" max="99" step="5"',
    hint: 'Where a "context is filling up" warning appears, for you and for the agent. Advisory only — it '
        + 'never stops an answer. Needs a context window set above.' },

  { key: 'memoryLimit', label: 'Memory entries', attrs: 'min="0" max="2000" step="1"',
    hint: 'How many remembered facts are put in front of the agent each turn. Pinned ones always come '
        + 'first, then whichever others match what you just asked.' },
];

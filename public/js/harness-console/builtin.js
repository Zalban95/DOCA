/* ═══════════════════════════════════════════════════════
   Harness tab: the built-in harness console's markup.
   ═══════════════════════════════════════════════════════ */

/* ── Built-in harness console ─────────────────────────── */

/** Each field's ⓘ (lib/field-info.js). */
const HC_INFO = {
  archived: 'Also list the conversations you put away. Archived ones stay readable and can be brought back; nothing is deleted.',
  memKey: 'A short name the fact is found by, for example favourite-colour. Writing the same name again replaces what it says.',
  memValue: 'The fact itself, in a sentence. Every agent here can read it in later conversations; ✕ in the list below forgets it.',
  specialists: 'Lets work chats send specialists — helpers for one kind of errand, such as code or the web — on missions. Off by default: the tools to send them do not exist, and work chats do the work themselves. Changing it asks for your password.',
  to: 'Who your message goes to: the Orchestrator (the default), or straight to one specialist as an errand of its own.',
  computer: 'Which of the agents\' computers — a separate desktop in a container — the specialist works in. "No computer" (the default) sends it without one.',
};

function _hcBuiltinHtml(h) {
  return `
    <div class="hc-org-guide">${pageHeadHtml({ title: 'Your agent, and the helpers it hands work to',
      sub: 'Your main chat is with the agent (the Orchestrator); open any of its work here.' })}
      <details class="desc page-about"><summary>What this is</summary>A bigger job gets a work chat of its own, where it is
        planned and done; a work chat may send a specialist — a helper for one kind of errand, such as code or the web. What
        they find comes back to your main chat. On the left: your conversations, what the agent remembers, its specialists,
        recipes (steps that worked, kept to run again) and schedules.</details></div>
    <div class="hc-layout">
      <div class="hc-side">
        <div class="hc-side-head">
          Workspace
          <button class="btn btn-xs btn-blue" onclick="hcNewSession()">+ Work</button>
          <button class="btn btn-xs" onclick="hcNewSession(true)" title="A work chat in Plan mode: it reads and proposes a plan, changes nothing until you approve it, then carries it out">+ Plan</button>
        </div>
        <label class="hc-archive-switch"><input type="checkbox" onchange="_hcArchived=this.checked;_hcLoadSessions()"> Show archived chats${infoBtn(HC_INFO.archived)}</label>
        <div id="hc-sessions" class="hc-sessions"><div class="placeholder">Loading…</div></div>
        <div class="hc-side-head" style="margin-top:10px">
          Memory
          <button class="btn btn-xs" onclick="hcRulesOpen()" title="The categories and rules it keeps memory by">Rules</button>
          <button class="btn btn-xs" onclick="_hcLoadMemory()" title="Refresh">↺</button>
        </div>
        <div class="hc-memory-add info-row">
          <input class="input" id="hc-mem-key" placeholder="name" aria-label="Name of the fact" onkeydown="if(event.key==='Enter') hcMemWrite()">${infoBtn(HC_INFO.memKey)}
          <input class="input" id="hc-mem-value" placeholder="what to remember" aria-label="What to remember" onkeydown="if(event.key==='Enter') hcMemWrite()">${infoBtn(HC_INFO.memValue)}
          <button class="btn btn-xs btn-blue" onclick="hcMemWrite()" title="Remember it">+</button>
        </div>
        <div id="hc-memory" class="hc-memory"><div class="placeholder">Loading…</div></div>

        <div class="hc-side-head hc-specialists-head info-row" style="margin-top:10px">
          Specialists
          <label class="hc-agents-switch" title="Enable specialist missions for work leaders. Existing work chats remain available.">
            <input type="checkbox" id="hc-agents-on" onchange="hcAgentsEnable(this.checked)">
            <span>on</span>
          </label>${infoBtn(HC_INFO.specialists)}
          <button class="btn btn-xs btn-blue" onclick="hcAgentNew()" title="Define a new specialist">+</button>
          <button class="btn btn-xs" onclick="hcAgentImport()" title="Import .md definitions — ours or Claude Code subagents">⬆</button>
        </div>
        <div id="hc-agents" class="hc-agents"><div class="placeholder">Loading…</div></div>
        <div class="hc-roster-links">See the tools <a href="#" onclick="hcAgentTools('orchestrator');return false">the Orchestrator holds</a>
          · <a href="#" onclick="hcAgentTools('work');return false">a work chat holds</a></div>

        <div class="hc-side-head hc-teams-head" style="margin-top:10px" title="Specialists on one board: tasks that wait on each other, each with its contract. The Orchestrator makes one with the team tool.">Teams</div>
        <div id="hc-teams" class="hc-agents"><div class="placeholder">Loading…</div></div>

        <div class="hc-side-head" style="margin-top:10px">
          Recipes
          <button class="btn btn-xs" onclick="hcRecipeKeep()" title="Keep what this conversation's last turn did, as a recipe">＋ last turn</button>
          <button class="btn btn-xs" onclick="hcSkillDraft()" title="Draft a skill from this conversation — when to use it, what worked — for you to read and save">＋ skill</button>
        </div>
        <div id="hc-recipes" class="hc-agents"><div class="placeholder">Loading…</div></div>

        <div class="hc-side-head" style="margin-top:10px">
          Schedules
          <button class="btn btn-xs" onclick="hcScheduleNew()" title="Send a message to a conversation on a timetable">＋</button>
        </div>
        <div id="hc-schedules" class="hc-agents"><div class="placeholder">Loading…</div></div>
      </div>

      <div class="hc-main">
        <div class="hc-head">
          <button class="btn btn-xs hc-side-toggle" onclick="hcSideToggle()" title="Conversations, memory and specialists">☰</button>
          <span class="hc-title" id="hc-session-title">${escHtml(h.label)}</span>
          <span class="badge badge-blue" id="hc-model-badge" style="font-size:9px">…</span>
          <span class="chat-model-host" id="hc-model-pick"></span>
          <span class="ctx-slot" id="hc-context"></span>
          <span class="hc-usage" id="hc-usage" title="Tokens today (UTC), every model call: steps, summaries and one-off asks. GET /api/harness/usage for the breakdown."></span>
          <span class="status-line" id="hc-status"></span>
          <div class="toolbar-right">
            <span id="hc-approval"></span>
            <button class="btn btn-xs" onclick="hcApprovalOpen()" title="What may run without asking">Approvals</button>
            <button class="btn btn-xs" onclick="hcEnvOpen()" title="Everything this agent is told about your machine">Context</button>
            <button class="btn btn-xs tool-gear" onclick="nav('controls'); harnessConfigToggle(${jsArg(h.id)}, true)" title="Model and parameters">⚙</button>
          </div>
        </div>
        <div class="pj-chat-tabs hc-tabs" id="hc-tabs" role="tablist"></div>
        <div class="conv-bar hc-conv" id="hc-conv"></div>
        <div id="hc-session-info" class="hc-session-info"></div>
        <div class="hc-missions" id="hc-missions" style="display:none"></div>
        <div class="hc-messages" id="hc-messages"><div class="placeholder">Ask it anything about this machine.</div></div>
        <div class="hc-proposals" id="hc-proposals"></div>
        <div class="agent-fold" id="hc-fold" hidden></div>
        <div class="hc-input-row info-row">
          <span class="hc-caret">❯</span>
          <select class="input hc-to" id="hc-to" style="display:none" onchange="_hcComputerShow()" title="Who this message goes to: the Orchestrator, or straight to one specialist as an errand"></select>
          ${infoBtn(HC_INFO.to)}
          <select class="input hc-to" id="hc-computer" style="display:none" title="Which of the agents' computers the specialist works in"></select>${infoBtn(HC_INFO.computer)}
          <textarea class="input flex1 hc-input" id="hc-input" rows="1" placeholder="Message the harness…"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();hcSend();}"></textarea>
          ${typeof micKeepHtml === 'function' ? micKeepHtml('hc-mic-keep') : ''}
          ${typeof thinkToggleHtml === 'function' ? thinkToggleHtml('hc-think') : ''}
          <button class="btn btn-sm btn-amber" id="hc-send" onclick="hcSend()">Send</button>
          <button class="btn btn-sm btn-red" id="hc-stop" style="display:none" onclick="hcStop()"
                  title="Stop this turn. The step already running finishes; nothing after it starts.">■ Stop</button>
        </div>
      </div>
    </div>`;
}

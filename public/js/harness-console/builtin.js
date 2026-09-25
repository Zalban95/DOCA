/* ═══════════════════════════════════════════════════════
   Harness tab: the built-in harness console's markup.
   ═══════════════════════════════════════════════════════ */

/* ── Built-in harness console ─────────────────────────── */

function _hcBuiltinHtml(h) {
  return `
    <div class="hc-org-guide"><strong>Orchestrator → Work leaders → Specialists</strong>
      <span>Your main chat reaches the Orchestrator. Work chats hold detailed execution and planning;
      specialists handle focused errands. Open any level here. Direct messages and results are reported upward.</span></div>
    <div class="hc-layout">
      <div class="hc-side">
        <div class="hc-side-head">
          Workspace
          <button class="btn btn-xs btn-blue" onclick="hcNewSession()">+ Work</button>
          <button class="btn btn-xs" onclick="hcNewSession(true)">+ Plan</button>
        </div>
        <label class="hc-archive-switch"><input type="checkbox" onchange="_hcArchived=this.checked;_hcLoadSessions()"> Show archived chats</label>
        <div id="hc-sessions" class="hc-sessions"><div class="placeholder">Loading…</div></div>
        <div class="hc-side-head" style="margin-top:10px">
          Memory
          <button class="btn btn-xs" onclick="hcRulesOpen()" title="The categories and rules it keeps memory by">Rules</button>
          <button class="btn btn-xs" onclick="_hcLoadMemory()" title="Refresh">↺</button>
        </div>
        <div class="hc-memory-add">
          <input class="input" id="hc-mem-key" placeholder="key" onkeydown="if(event.key==='Enter') hcMemWrite()">
          <input class="input" id="hc-mem-value" placeholder="what to remember" onkeydown="if(event.key==='Enter') hcMemWrite()">
          <button class="btn btn-xs btn-blue" onclick="hcMemWrite()">+</button>
        </div>
        <div id="hc-memory" class="hc-memory"><div class="placeholder">Loading…</div></div>

        <div class="hc-side-head" style="margin-top:10px">
          Specialists
          <label class="hc-agents-switch" title="Enable specialist missions for work leaders. Existing work chats remain available.">
            <input type="checkbox" id="hc-agents-on" onchange="hcAgentsEnable(this.checked)">
            <span>on</span>
          </label>
          <button class="btn btn-xs btn-blue" onclick="hcAgentNew()" title="Define a new specialist">+</button>
        </div>
        <div id="hc-agents" class="hc-agents"><div class="placeholder">Loading…</div></div>
      </div>

      <div class="hc-main">
        <div class="hc-head">
          <span class="hc-title" id="hc-session-title">${escHtml(h.label)}</span>
          <span class="badge badge-blue" id="hc-model-badge" style="font-size:9px">…</span>
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
        <div id="hc-session-info" class="hc-session-info"></div>
        <div class="hc-missions" id="hc-missions" style="display:none"></div>
        <div class="hc-messages" id="hc-messages"><div class="placeholder">Ask it anything about this machine.</div></div>
        <div class="hc-proposals" id="hc-proposals"></div>
        <div class="hc-input-row">
          <span class="hc-caret">❯</span>
          <textarea class="input flex1 hc-input" id="hc-input" rows="1" placeholder="Message the harness…"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();hcSend();}"></textarea>
          <button class="btn btn-sm btn-amber" id="hc-send" onclick="hcSend()">Send</button>
          <button class="btn btn-sm btn-red" id="hc-stop" style="display:none" onclick="hcStop()"
                  title="Stop this turn. The step already running finishes; nothing after it starts.">■ Stop</button>
        </div>
      </div>
    </div>`;
}

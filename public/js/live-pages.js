/* Every page live on every screen (TODO H10.5): which part of the panel redraws on which change (lib/live.js). A
   conversation open here that works because of another screen — a phone, a voice call, a watch, a schedule — shows
   its answer as it streams and every row as it is written; the missions bar, the Files tab, a project's open files and
   its conversations' tabs follow too (the file trees watch themselves, lib/filetree.js). What this screen is doing
   itself it already draws, so a turn it started is left to it. */

/* The answer's text as it streams, per conversation, since its last written row: kept here rather than only on the
   page, so a redraw (the turn started, a row was written) draws it again instead of losing it. */
const _liveBuf = new Map();
const _liveThinking = new Set();   // conversations whose model thinks before it answers: said, until text comes

/** What has streamed into `sid` so far, drawn plain at the end of `box` until its row is written. */
function _liveShow(box, sid, make) {
  const text = _liveBuf.get(sid) || (_liveThinking.has(sid) ? 'Thinking…' : '');
  if (!box || !text) return;
  let el = box.querySelector('.live-stream');   // a working block may hold it
  if (!el) { el = make(); if (!el) return; el.classList.add('live-stream'); }
  (el.querySelector('.hc-msg-body') || el).textContent = text;
  box.scrollTop = box.scrollHeight;
}

/* ── The Harness console: the conversation open, and the list beside it ── */
const _liveHc = () => _liveShow(document.getElementById('hc-messages'), _hcSession, () => _hcAppend('assistant', '', null, { plain: true }));
const _liveHcReload = liveDebounce(() => { if (_hcSession && !_hcBusy) hcOpenSession(_hcSession, true); }, 300);   // which draws the streamed text again
const _liveHcList = liveDebounce(() => { if (document.getElementById('hc-sessions')) _hcLoadSessions(true); }, 800);
const _liveMissions = liveDebounce(() => { if (document.getElementById('hc-missions')) _hcLoadMissions(); }, 500);

/* ── The floating chat: the Orchestrator's conversation ── */
let _liveChatSession = null;
const _liveChat = () => _liveShow(document.getElementById('chat-messages'), _liveChatSession, () => chatAppendMsg('assistant', ''));
const _liveChatReload = liveDebounce(async () => { if (!chatTurn && chatLoaded) { await chatLoadHistory(); _liveChat(); } }, 300);

/* ── Projects: a conversation's tab ── */
function _livePjTab(c) {
  if (typeof PJC === 'undefined' || !document.getElementById('pj-chat-stack')) return;
  const t = PJC.tabs.get(c.id);
  if (!t) { if (c.what === 'started') pjTabsSync(); return; }   // a sub-agent's tab, opened as it starts
  if (t.busy) return;
  const show = () => _liveShow(t.box, t.id, () => _pjChatRow('assistant', '', t.box));
  if (c.what === 'text') return show();
  t.reload ||= liveDebounce(async () => {
    if (t.busy) return;
    t.box.innerHTML = ''; t.loaded = false;
    if (PJC.active === t.id) { await pjChatActivate(t.id); show(); }
  }, 300);
  t.reload();
}

function _liveConversation(c) {
  if (c.what === 'resync') { _liveBuf.clear(); _liveThinking.clear(); _liveHcReload(); _liveChatReload(); return; }
  if (c.what === 'thinking') { _liveThinking.add(c.id); c = { ...c, what: 'text' }; }   // drawn where the text will stream
  else if (c.what === 'text') { _liveThinking.delete(c.id); _liveBuf.set(c.id, (_liveBuf.get(c.id) || '') + c.delta); }
  else if (c.what !== 'tool') { _liveBuf.delete(c.id); _liveThinking.delete(c.id); }   // a turn began, a row was written, the turn ended: what streamed is in the transcript now
  if (c.what === 'started' || c.what === 'ended') _liveHcList();
  if (c.id === _hcSession && !_hcBusy) {
    if (c.what === 'text') _liveHc();
    else if (c.what !== 'tool') _liveHcReload();
  }
  if (c.id === _liveChatSession && !chatTurn) {
    if (c.what === 'text') _liveChat();
    else if (c.what !== 'tool') _liveChatReload();
  }
  _livePjTab(c);
}

/* ── Files: the folder the tab shows, and the files open in a project ── */
const _liveFm = liveDebounce(async () => {
  if (typeof fm === 'undefined' || fmApi() !== '/api/files' || !document.getElementById('fm-list-inner')?.offsetParent) return;
  try { fm.entries = (await apiFetch(`/api/files/list?path=${encodeURIComponent(fm.cwd)}`)).entries || []; fmRenderList(); fmUpdateStatus(); }
  catch { /* gone: the next navigation says so */ }
}, 400);
const _livePjOpen = liveDebounce(() => { if (typeof PJE !== 'undefined' && PJE.tabs.length) pjEditorsReloadClean(); }, 400);

/** The folders holding a project's open files, watched while they are open. */
let _liveLastPj = '';
function liveProjectFiles() {
  if (typeof PJE === 'undefined') return;
  const dirs = [...new Set(PJE.tabs.filter(t => t.path && t.model).map(t => t.path.slice(0, t.path.lastIndexOf('/')) || '/'))];
  if (dirs.join('\n') === _liveLastPj) return;   // the tab strip redraws on every keystroke; the folders rarely change
  _liveLastPj = dirs.join('\n');
  liveFolders('project-files', dirs);
}

function _liveFiles(c) {
  if (c.what === 'resync' || (typeof fm !== 'undefined' && c.id === fm.cwd)) _liveFm();
  if (c.what === 'resync' || (typeof PJE !== 'undefined' && PJE.tabs.some(t => t.path && t.path.slice(0, t.path.lastIndexOf('/')) === c.id))) _livePjOpen();
}

/** The Files tab's folder, watched while it is the one shown (files.js fmRefresh). */
function liveFilesTab() {
  if (typeof fm === 'undefined') return;
  liveFolders('files-tab', fmApi() === '/api/files' && fm.cwd ? [fm.cwd] : []);
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  liveOn('conversation', _liveConversation);
  liveOn('missions', _liveMissions);
  liveOn('files', _liveFiles);
  apiFetch('/api/chat/history').then(d => { _liveChatSession = d.sessionId || null; }).catch(() => {});
});

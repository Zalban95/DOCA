/* One view of the hive chat (people-data.js holds the state): the list of a person's conversations — their agents
   first, then direct messages, groups and channels — and one conversation open, with its messages, a composer, replies,
   reactions, pins, mentions and who has read what. The Chat page shows the two side by side; the floating chat's People
   shows one at a time. Every click is a `data-act` handled here, so the markup carries no code. */

const PC_QUICK = ['👍', '❤️', '😄', '🎉', '👀', '✅'];
const PC_KIND = { dm: 'Direct messages', group: 'Groups', channel: 'Channels' };

const _pcInitials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const _pcHue = id => [...String(id || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function _pcAvatar(id, name, kind = 'person') {
  if (kind === 'agent') return '<span class="pc-av pc-av-agent" aria-hidden="true"><i></i><i></i><i></i></span>';
  if (kind === 'group' || kind === 'channel') return `<span class="pc-av pc-av-${kind}" aria-hidden="true">${kind === 'channel' ? '#' : _pcInitials(name)}</span>`;
  return `<span class="pc-av" style="--pc-h:${_pcHue(id)}" aria-hidden="true">${escHtml(_pcInitials(name))}</span>`;
}
function _pcTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function peopleView(root, mode) {
  const v = { root, mode, open: null, thread: null, q: '' };

  v.listHtml = () => {
    const d = PEOPLE.data;
    if (!d) return '<div class="placeholder pulse">Loading…</div>';
    if (d.error) return `<div class="placeholder">${escHtml(d.error)}</div>`;
    const q = v.q.toLowerCase(), hit = s => !q || String(s.title || s.name || '').toLowerCase().includes(q);
    const agentRow = a => `<button type="button" class="pc-row" data-act="agent" data-id="${escHtml(a.id || '')}" data-kind="${escHtml(a.kind)}">
      ${_pcAvatar(a.id, a.title, 'agent')}<span class="pc-row-text"><span class="pc-row-title">${escHtml(a.title)}</span>
      <span class="pc-row-sub">${a.kind === 'orchestrator' ? 'Your own agent — only you see it' : a.state === 'running' ? 'working…' : 'work chat'}</span></span></button>`;
    const row = s => `<button type="button" class="pc-row${s.id === v.open ? ' active' : ''}${s.unread && !s.muted ? ' unread' : ''}" data-act="open" data-id="${escHtml(s.id)}">
      ${_pcAvatar(s.other || s.id, s.title, s.kind === 'dm' ? 'person' : s.kind)}
      <span class="pc-row-text"><span class="pc-row-title">${escHtml(s.title)}${s.muted ? ' <span class="pc-muted" title="Muted">·  muted</span>' : ''}</span>
      <span class="pc-row-sub">${s.last ? `${s.kind !== 'dm' && s.last.by ? `${escHtml(s.last.by)}: ` : ''}${escHtml(s.last.text)}` : '<em>No messages yet</em>'}</span></span>
      <span class="pc-row-meta"><span class="pc-time">${_pcTime(s.lastAt)}</span>${s.unread ? `<span class="pc-unread">${s.unread > 99 ? '99+' : s.unread}</span>` : ''}</span></button>`;
    const groups = Object.entries(PC_KIND).map(([k, label]) => {
      const list = d.spaces.filter(s => s.kind === k && hit(s));
      return list.length ? `<div class="pc-sec">${label}</div>${list.map(row).join('')}` : '';
    }).join('');
    const join = d.joinable.filter(hit);
    const agents = (d.agents || []).filter(a => !q || a.title.toLowerCase().includes(q));
    return `${agents.length ? `<div class="pc-sec">Your agents</div>${agents.map(agentRow).join('')}` : ''}${groups}
      ${join.length ? `<div class="pc-sec">Channels to join</div>${join.map(c => `<button type="button" class="pc-row pc-join" data-act="open" data-id="${escHtml(c.id)}">
        ${_pcAvatar(c.id, c.title, 'channel')}<span class="pc-row-text"><span class="pc-row-title">${escHtml(c.title)}</span><span class="pc-row-sub">${escHtml(c.topic || 'Open to join')}</span></span></button>`).join('')}` : ''}
      ${!d.spaces.length && !join.length ? emptyStateHtml({ title: 'No conversations yet', text: 'Start one with a colleague: ＋ above, or a person\'s card.' }) : ''}`;
  };

  v.list = () => {
    const el = root.querySelector('.pc-list-body');
    if (el) el.innerHTML = v.listHtml();
    const plus = root.querySelector('[data-act="new"]');
    if (plus) plus.hidden = !PEOPLE.data?.may?.write;
  };

  v.showing = () => (v.open && root.isConnected && root.offsetParent !== null ? v.open : null);

  /* ── One conversation ── */
  v.openSpace = async id => {
    v.open = id; v.thread = null;
    const pane = root.querySelector('.pc-space');
    if (!pane) return;
    root.classList.add('pc-has-open');
    pane.innerHTML = `<div class="pc-head"></div><div class="pc-pins" hidden></div><div class="pc-msgs" role="log" aria-live="polite"><div class="placeholder pulse">Loading…</div></div>
      <div class="pc-typing" aria-live="polite"></div><div class="pc-replybar" hidden></div><div class="pc-mention" hidden></div>
      <div class="pc-compose"><button type="button" class="icon-btn" data-act="attach" title="Attach a file" aria-label="Attach a file">📎</button>
        <input type="file" class="pc-file" multiple hidden><div class="pc-chips"></div>
        <textarea class="chat-input pc-input" rows="1" placeholder="Message…" aria-label="Message"></textarea>
        <button type="button" class="btn btn-sm btn-primary" data-act="send">Send</button></div>`;
    v.list();
    try {
      const full = await apiFetch(`/api/people/spaces/${encodeURIComponent(id)}`);   // its members and pins
      const row = peopleSpace(id);
      if (row) Object.assign(row, full); else PEOPLE.data?.spaces.unshift(full);
      await peopleMessages(id);
    } catch (e) { pane.querySelector('.pc-msgs').innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; return; }
    v.space(id, { bottom: true });
    v.wireComposer(pane);
    peopleMarkRead(id);
  };

  v.close = () => { v.open = null; root.classList.remove('pc-has-open'); const pane = root.querySelector('.pc-space'); if (pane) pane.innerHTML = v.blankHtml(); v.list(); };
  v.blankHtml = () => `<div class="pc-blank">${emptyStateHtml({ title: 'Hive chat', text: 'Pick a conversation, or start one. Write @orchestrator in a conversation to bring your own agent in: it answers there, as your agent, with your rights.' })}</div>`;

  v.space = (id, { bottom = false } = {}) => {
    if (id !== v.open) return;
    const pane = root.querySelector('.pc-space'), s = peopleSpace(id);
    if (!pane || !s || !pane.querySelector('.pc-msgs')) return;
    v.head(pane, s);
    const box = pane.querySelector('.pc-msgs');
    const atEnd = bottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const list = PEOPLE.msgs.get(id) || [];
    const shown = v.thread ? list.filter(m => m.id === v.thread || m.replyTo === v.thread) : list;
    box.replaceChildren(...peopleMessageEls(s, shown, { thread: v.thread, older: !v.thread && PEOPLE.older.get(id) }));
    if (atEnd) box.scrollTop = box.scrollHeight;
    const t = PEOPLE.typing.get(id);
    pane.querySelector('.pc-typing').textContent = t && t.until > Date.now() ? `${t.name} is typing…` : '';
    const pins = pane.querySelector('.pc-pins');
    const pinned = (s.pins || []).map(p => list.find(m => m.id === p.messageId)).filter(Boolean);
    pins.hidden = !pinned.length || !!v.thread;
    pins.innerHTML = pinned.length ? `<span class="pc-pin-ico" aria-hidden="true">📌</span>${pinned.slice(0, 2).map(m => `<button type="button" class="pc-pin" data-act="jump" data-id="${escHtml(m.id)}">${escHtml(String(m.text).slice(0, 80))}</button>`).join('')}` : '';
    const r = PEOPLE.reply.get(id), bar = pane.querySelector('.pc-replybar');
    bar.hidden = !r;
    bar.innerHTML = r ? `<span>Replying to <b>${escHtml(r.agentLabel || r.author?.name || '')}</b>: ${escHtml(String(r.text).slice(0, 90))}</span><button type="button" class="icon-btn" data-act="noreply" aria-label="Cancel the reply">✕</button>` : '';
    const ro = !s.member || !PEOPLE.data?.may?.write;
    pane.querySelector('.pc-compose').classList.toggle('pc-ro', ro);
    pane.querySelector('.pc-input').placeholder = !s.member ? 'Join this channel to write in it' : !PEOPLE.data?.may?.write ? 'Your level reads here and writes nothing' : `Message ${s.kind === 'channel' ? `#${s.title}` : s.title}…${mode === 'page' && innerWidth > 760 ? '  (@orchestrator asks your agent)' : ''}`;
  };

  v.head = (pane, s) => {
    const sub = v.thread ? 'Thread' : s.kind === 'dm' ? 'Direct message' : s.kind === 'channel' ? (s.topic || `Channel · ${s.members.length} members`) : `${s.members.length} people${s.topic ? ` · ${s.topic}` : ''}`;
    pane.querySelector('.pc-head').innerHTML = `${mode === 'float' || v.thread ? `<button type="button" class="icon-btn pc-back" data-act="${v.thread ? 'unthread' : 'back'}" aria-label="Back">‹</button>` : '<button type="button" class="icon-btn pc-back pc-back-phone" data-act="back" aria-label="Back to the list">‹</button>'}
      <button type="button" class="pc-head-who" data-act="who">${_pcAvatar(s.other || s.id, s.title, s.kind === 'dm' ? 'person' : s.kind)}
        <span class="pc-head-text"><span class="pc-head-title">${escHtml(s.kind === 'channel' ? `#${s.title}` : s.title)}</span><span class="pc-head-sub">${escHtml(sub)}</span></span></button>
      <span class="pc-head-acts">${s.member ? `<button type="button" class="icon-btn" data-act="call" data-hook="call" title="Call" aria-label="Call">📞</button>
        <button type="button" class="icon-btn" data-act="share" data-hook="share-screen" title="Share your screen" aria-label="Share your screen">🖵</button>` : `<button type="button" class="btn btn-sm btn-primary" data-act="join">Join</button>`}
        ${s.member ? `<span class="row-more"><button type="button" class="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded="false" onclick="rowMoreToggle(this)">${typeof uiIcon === 'function' ? uiIcon('more') : '⋯'}</button>
          <span class="row-more-menu" role="menu" hidden>
            <button type="button" class="row-more-item" role="menuitem" data-act="mute">${s.muted ? 'Unmute' : 'Mute'}</button>
            ${s.kind !== 'dm' ? '<button type="button" class="row-more-item" role="menuitem" data-act="members">People in it</button><button type="button" class="row-more-item" role="menuitem" data-act="rename">Rename or set the topic</button><button type="button" class="row-more-item" role="menuitem" data-act="leave">Leave</button>' : ''}
          </span></span>` : ''}</span>`;
  };

  v.wireComposer = pane => {
    const input = pane.querySelector('.pc-input'), file = pane.querySelector('.pc-file');
    v.files = [];
    let typedAt = 0;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); v.send(); }
      if (e.key === 'Escape' && PEOPLE.reply.get(v.open)) { PEOPLE.reply.delete(v.open); v.space(v.open); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`;
      v.mention(pane, input);
      if (Date.now() - typedAt > 3000 && input.value.trim()) { typedAt = Date.now(); apiFetch(`/api/people/spaces/${encodeURIComponent(v.open)}/typing`, { method: 'POST' }).catch(() => {}); }
    });
    file.addEventListener('change', async () => { for (const f of [...file.files]) await v.attach(pane, f); file.value = ''; });
  };

  v.attach = async (pane, f) => {
    const chips = pane.querySelector('.pc-chips');
    const chip = Object.assign(document.createElement('span'), { className: 'pc-chip', textContent: `${f.name} …` });
    chips.append(chip);
    try {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch('/api/attachments', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      v.files.push(data.name);
      chip.textContent = data.name;
    } catch (e) { chip.classList.add('bad'); chip.textContent = `${f.name} — ${e.message}`; }
  };

  /** "@" suggestions: the people in it, and your own agent. */
  v.mention = (pane, input) => {
    const box = pane.querySelector('.pc-mention'), s = peopleSpace(v.open);
    const m = /(^|\s)@([\p{L}\p{N}._-]*)$/u.exec(input.value.slice(0, input.selectionStart));
    if (!m || !s) { box.hidden = true; return; }
    const w = m[2].toLowerCase();
    const opts = [{ word: 'orchestrator', label: 'Your agent', sub: 'answers here as your agent' },
      ...s.members.filter(x => x.id !== PEOPLE.data?.me?.id).map(x => ({ word: x.name.split(/\s+/)[0], label: x.name, sub: '' }))].filter(o => o.word.toLowerCase().startsWith(w)).slice(0, 6);
    box.hidden = !opts.length;
    box.innerHTML = opts.map(o => `<button type="button" class="pc-mention-opt" data-act="mention" data-word="${escHtml(o.word)}"><b>@${escHtml(o.word)}</b> ${escHtml(o.label)}${o.sub ? ` <em>${escHtml(o.sub)}</em>` : ''}</button>`).join('');
  };

  v.send = async () => {
    const pane = root.querySelector('.pc-space'), input = pane?.querySelector('.pc-input');
    const s = peopleSpace(v.open);
    if (!input || !s?.member) return;
    const text = input.value.trim();
    if (!text && !v.files.length) return;
    const body = { text, attachments: v.files, replyTo: v.thread || PEOPLE.reply.get(v.open)?.id || null };
    input.value = ''; input.style.height = 'auto';
    pane.querySelector('.pc-chips').innerHTML = ''; v.files = [];
    PEOPLE.reply.delete(v.open);
    pane.querySelector('.pc-mention').hidden = true;
    try {
      const m = await apiFetch(`/api/people/spaces/${encodeURIComponent(v.open)}/messages`, { method: 'POST', body });
      peoplePut(m);
      s.readSeq = m.seq; s.lastSeq = Math.max(s.lastSeq, m.seq);
      v.space(v.open, { bottom: true });
    } catch (e) { input.value = text; appAlert(e.message); }
  };

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    peopleAct(v, b.dataset.act, b);
  });
  root.querySelector('.pc-search')?.addEventListener('input', e => { v.q = e.target.value; v.list(); });
  PEOPLE.views.add(v);
  return v;
}

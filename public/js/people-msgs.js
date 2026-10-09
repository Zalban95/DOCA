/* The hive chat's messages as elements (people-view.js draws them): a day line, an author's run of messages under one
   name, markdown through the transcript's own renderer (markdown.js, which builds elements — never a page's HTML), a
   quote of what it answers, files, reactions, the thread it starts, "Seen" under your last one, and the actions a
   message offers. An agent's answer says whose agent wrote it. And every `data-act` the views hand over. */

function _pcEl(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function _pcFiles(m) {
  const wrap = _pcEl('div', 'pc-files');
  for (const a of m.attachments || []) {
    const src = `/api/attachments/${encodeURIComponent(a.name)}`;
    if (a.kind === 'image') {
      const img = Object.assign(document.createElement('img'), { src, alt: a.name, className: 'pc-img' });
      img.addEventListener('click', () => typeof mediaViewerOpen === 'function' && mediaViewerOpen({ src, name: a.name, kind: 'image', download: src }));
      wrap.append(img);
    } else wrap.append(Object.assign(document.createElement('a'), { href: src, className: 'pc-file-link', textContent: `📄 ${a.name}`, target: '_blank', rel: 'noopener' }));
  }
  return wrap;
}

/** Messages of space `s`, as elements, oldest first. */
function peopleMessageEls(s, list, { thread = null, older = false } = {}) {
  const me = PEOPLE.data?.me?.id, out = [];
  if (older) { const b = _pcEl('button', 'btn btn-xs pc-older', 'Earlier messages'); b.type = 'button'; b.dataset.act = 'older'; out.push(b); }
  if (!list.length) out.push(_pcEl('div', 'pc-empty', s.member ? 'Nothing here yet — say hello.' : 'Nothing here yet.'));
  const byId = new Map((PEOPLE.msgs.get(s.id) || []).map(m => [m.id, m]));
  const lastMine = [...list].reverse().find(m => m.author?.id === me && !m.agent);
  let day = '', prev = null;
  for (const m of list) {
    const d = new Date(m.at).toDateString();
    if (d !== day) { out.push(_pcEl('div', 'pc-day', new Date(m.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))); day = d; prev = null; }
    const who = m.agent ? `${m.author?.id}:agent` : m.author?.id;
    const run = prev && prev.who === who && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60e3 && !m.replyTo;
    const row = _pcEl('div', `pc-msg${m.author?.id === me && !m.agent ? ' mine' : ''}${m.agent ? ' agent' : ''}${run ? ' run' : ''}${m.deletedAt ? ' gone' : ''}`);
    row.dataset.id = m.id;
    if (!run) {
      const head = _pcEl('div', 'pc-msg-head');
      head.innerHTML = m.agent ? _pcAvatar(m.author?.id, '', 'agent') : _pcAvatar(m.author?.id, m.author?.name);
      const name = _pcEl('button', 'pc-msg-name', m.agentLabel || m.author?.name || '');
      name.type = 'button'; name.dataset.act = 'card'; name.dataset.id = m.author?.id || '';
      head.append(name);
      if (m.agent) head.append(_pcEl('span', 'pc-badge', 'agent'));
      head.append(_pcEl('time', 'pc-msg-time', _pcTime(m.at)));
      row.append(head);
    }
    const bubble = _pcEl('div', 'pc-bubble');
    if (m.replyTo && !thread) {
      const r = byId.get(m.replyTo);
      const q = _pcEl('button', 'pc-quote', r ? `${r.agentLabel || r.author?.name}: ${r.deletedAt ? '(deleted)' : String(r.text).slice(0, 100)}` : 'a message');
      q.type = 'button'; q.dataset.act = 'thread'; q.dataset.id = m.replyTo;
      bubble.append(q);
    }
    const body = _pcEl('div', 'pc-text');
    if (m.deletedAt) body.textContent = 'This message was deleted.';
    else if (typeof mdInto === 'function') mdInto(body, m.text || ''); else body.textContent = m.text || '';
    bubble.append(body);
    if (m.attachments?.length) bubble.append(_pcFiles(m));
    if (m.editedAt && !m.deletedAt) bubble.append(_pcEl('span', 'pc-edited', 'edited'));
    row.append(bubble);
    const reacts = Object.entries(m.reactions || {});
    if (reacts.length) {
      const bar = _pcEl('div', 'pc-reacts');
      for (const [e, ids] of reacts) {
        const b = _pcEl('button', `pc-react${ids.includes(me) ? ' mine' : ''}`, `${e} ${ids.length}`);
        b.type = 'button'; b.dataset.act = 'react'; b.dataset.id = m.id; b.dataset.emoji = e; b.dataset.on = ids.includes(me) ? '0' : '1';
        b.title = (s.members || []).filter(x => ids.includes(x.id)).map(x => x.name).join(', ');
        bar.append(b);
      }
      row.append(bar);
    }
    if (m.replies && !thread) { const t = _pcEl('button', 'pc-thread-link', `${m.replies} ${m.replies === 1 ? 'reply' : 'replies'}`); t.type = 'button'; t.dataset.act = 'thread'; t.dataset.id = m.id; row.append(t); }
    if (m === lastMine) {
      const seen = (s.members || []).filter(x => x.id !== me && (x.readSeq || 0) >= m.seq);
      if (seen.length) row.append(_pcEl('div', 'pc-seen', s.kind === 'dm' ? 'Seen' : `Seen by ${seen.length === 1 ? seen[0].name : `${seen.length}`}`));
    }
    if (!m.deletedAt && s.member) row.append(_pcActs(m, me));
    out.push(row);
    prev = { who, at: m.at };
  }
  return out;
}

function _pcActs(m, me) {
  const bar = _pcEl('div', 'pc-acts');
  const b = (act, label, text) => { const x = _pcEl('button', 'icon-btn', text); x.type = 'button'; x.dataset.act = act; x.dataset.id = m.id; x.title = label; x.setAttribute('aria-label', label); bar.append(x); return x; };
  for (const e of PC_QUICK.slice(0, 3)) { const x = b('react', `React ${e}`, e); x.dataset.emoji = e; x.dataset.on = '1'; }
  b('reply', 'Reply', '↩');
  b('pin', 'Pin or unpin', '📌');
  if (m.author?.id === me && !m.agent) b('edit', 'Edit', '✎');
  if (m.author?.id === me) b('delete', 'Delete', '🗑');
  return bar;
}

const _pcSpaceUrl = (id, tail = '') => `/api/people/spaces/${encodeURIComponent(id)}${tail}`;

/** What every `data-act` in a view does. */
async function peopleAct(v, act, el) {
  const id = el.dataset.id, s = peopleSpace(v.open), msg = id && (PEOPLE.msgs.get(v.open) || []).find(m => m.id === id);
  const run = async fn => { try { await fn(); } catch (e) { appAlert(e.message); } };
  switch (act) {
    case 'open': return v.openSpace(id);
    case 'agent': return peopleOpenAgent(id, el.dataset.kind);
    case 'back': return v.close();
    case 'new': return peopleNewOpen(v.mode);
    case 'org': return peopleOrgOpen();
    case 'search': return peopleSearchOpen();
    case 'card': return id && peopleCardOpen(id);
    case 'who': return s && (s.kind === 'dm' ? peopleCardOpen(s.other) : peopleMembersOpen(s));
    case 'members': return s && peopleMembersOpen(s);
    case 'send': return v.send();
    case 'attach': return v.root.querySelector('.pc-file')?.click();
    case 'older': return run(async () => { await peopleMessages(v.open, { older: true }); v.space(v.open); });
    case 'thread': v.thread = id; return v.space(v.open, { bottom: true });
    case 'unthread': v.thread = null; return v.space(v.open, { bottom: true });
    case 'reply': if (msg) { PEOPLE.reply.set(v.open, msg); v.space(v.open); v.root.querySelector('.pc-input')?.focus(); } return;
    case 'noreply': PEOPLE.reply.delete(v.open); return v.space(v.open);
    case 'jump': { const row = v.root.querySelector(`.pc-msg[data-id="${CSS.escape(id)}"]`); row?.scrollIntoView({ block: 'center' }); row?.classList.add('pc-flash'); return setTimeout(() => row?.classList.remove('pc-flash'), 1600); }
    case 'mention': {
      const input = v.root.querySelector('.pc-input');
      const at = input.selectionStart, before = input.value.slice(0, at).replace(/@[\p{L}\p{N}._-]*$/u, `@${el.dataset.word} `);
      input.value = before + input.value.slice(at); input.focus(); input.selectionStart = input.selectionEnd = before.length;
      v.root.querySelector('.pc-mention').hidden = true; return;
    }
    case 'react': return run(async () => { peoplePut(await apiFetch(`/api/people/messages/${encodeURIComponent(id)}/react`, { method: 'POST', body: { emoji: el.dataset.emoji, on: el.dataset.on !== '0' } })); v.space(v.open); });
    case 'pin': return run(async () => {
      const pinned = (s?.pins || []).some(p => p.messageId === id);
      const r = await apiFetch(`/api/people/messages/${encodeURIComponent(id)}/pin`, { method: 'POST', body: { on: !pinned } });
      if (s) s.pins = r.pins; v.space(v.open);
    });
    case 'edit': return msg && appPrompt('Edit your message', text => run(async () => { peoplePut(await apiFetch(`/api/people/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: { text } })); v.space(v.open); }), msg.text);
    case 'delete': return appConfirm('Delete this message? Everyone in the conversation sees that it was deleted.', () => run(async () => { peoplePut(await apiFetch(`/api/people/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })); v.space(v.open); }));
    case 'join': return run(async () => { await apiFetch(_pcSpaceUrl(v.open, '/join'), { method: 'POST' }); await peopleLoad(); v.openSpace(v.open); });
    case 'leave': rowMoreClose(); return appConfirm(`Leave ${s?.title || 'this conversation'}?`, () => run(async () => { await apiFetch(_pcSpaceUrl(v.open, '/leave'), { method: 'POST' }); v.close(); peopleLoad(); }));
    case 'mute': rowMoreClose(); return run(async () => { await apiFetch(_pcSpaceUrl(v.open, '/mine'), { method: 'POST', body: { muted: !s.muted } }); s.muted = !s.muted; v.space(v.open); peopleDrawLists(); });
    case 'rename': rowMoreClose(); return appPrompt(`Name of ${s?.title}  (a second line sets its topic)`, text => run(async () => {
      const [name, ...topic] = String(text).split('\n');
      Object.assign(s, await apiFetch(_pcSpaceUrl(v.open), { method: 'PATCH', body: { name: name.trim(), ...(topic.length ? { topic: topic.join(' ').trim() } : {}) } }));
      v.space(v.open); peopleDrawLists();
    }), `${s?.name || ''}${s?.topic ? `\n${s.topic}` : ''}`);
    case 'call': case 'share': return peopleCallHook(act === 'call' ? 'call' : 'share-screen', s);
    default: return undefined;
  }
}

/**
 * Calls and screen sharing between people arrive with meetings (another piece of work): it registers
 * `window.peopleCallProvider = { start(kind, space) }` and these buttons use it. Until then they say so.
 */
function peopleCallHook(kind, space) {
  if (window.peopleCallProvider?.start) return window.peopleCallProvider.start(kind, space);
  appAlert(kind === 'call' ? 'Calls between people come with meetings, a later release. Until then, write here — or call your own agent with 🎙 in the floating chat.'
    : 'Sharing your screen with colleagues comes with meetings, a later release.');
}

/** Your agents open where they live: your Orchestrator in the floating chat (docked on the Chat page), a work chat in the Harness. */
function peopleOpenAgent(id, kind) {
  if (kind === 'orchestrator') return typeof peopleDockAgent === 'function' && currentTab === 'people' ? peopleDockAgent() : (!chatOpen && toggleChat());
  nav('harness');
  if (typeof hcOpenSession === 'function') hcOpenSession(id);
}

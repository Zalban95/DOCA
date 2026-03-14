/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — FLOATING CHAT (agent)
   ═══════════════════════════════════════════════════════ */

let chatLoaded = false;

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
  document.getElementById('chat-fab').classList.toggle('active', chatOpen);
  if (chatOpen && !chatLoaded) {
    chatLoaded = true;
    chatLoadHistory();
  }
  if (chatOpen) document.getElementById('chat-input').focus();
}

async function chatLoadHistory() {
  try {
    const data = await apiFetch('/api/chat/history');
    const msgs = data.messages || [];
    if (msgs.length) {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      msgs.forEach(m => chatAppendMsg(m.role, m.content));
    }
  } catch {}
}

function chatAppendMsg(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function chatSend() {
  const input   = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  chatAppendMsg('user', message);

  const responseEl = chatAppendMsg('assistant', '');
  responseEl.classList.add('pulse');

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  }).then(res => {
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    responseEl.textContent = '';
    responseEl.classList.remove('pulse');

    function read() {
      reader.read().then(({ done, value }) => {
        if (done) return;
        const text = decoder.decode(value);
        text.split('\n').forEach(line => {
          if (!line.startsWith('data: ')) return;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') {
              responseEl.textContent += evt.text;
            } else if (evt.type === 'stderr') {
              responseEl.textContent += evt.text;
            }
          } catch {}
        });
        document.getElementById('chat-messages').scrollTop =
          document.getElementById('chat-messages').scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => {
    responseEl.classList.remove('pulse');
    responseEl.textContent = `Error: ${e.message}`;
    responseEl.style.color = 'var(--red)';
  });
}

function chatClear() {
  appConfirm('Clear chat history?', async () => {
    try {
      await apiFetch('/api/chat/clear', { method: 'POST' });
      const container = document.getElementById('chat-messages');
      container.innerHTML = '<div class="chat-msg system">Chat cleared. Send a message to start a new conversation.</div>';
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

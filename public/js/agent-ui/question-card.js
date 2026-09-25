/* ═══════════════════════════════════════════════════════
   A question for the owner: its choices as buttons, an answer in their own
   words, and a way to talk it over in the chat. One component, meant for every
   place the owner is asked something — the rules review first, then the chat
   and the Orchestrator's questions (TODO.md).
   ═══════════════════════════════════════════════════════ */

/**
 * @param {{ question: string, choices?: string[],
 *           onAnswer: (text: string) => Promise<string|void>,
 *           discuss?: string|false }} q
 *   `onAnswer` applies the answer and resolves to a line saying what it did;
 *   `discuss` is the message the chat opens with (false: no discuss button).
 * @returns {HTMLElement}
 */
function questionCardEl({ question, choices = [], onAnswer, discuss }) {
  const card = document.createElement('div');
  card.className = 'question-card';

  const q = document.createElement('div');
  q.className = 'question-card-q';
  q.textContent = question;
  card.appendChild(q);

  const buttons = [];
  const row = document.createElement('div');
  row.className = 'question-card-choices';
  for (const c of choices) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.textContent = c;
    b.onclick = () => answer(c);
    buttons.push(b);
    row.appendChild(b);
  }
  if (choices.length) card.appendChild(row);

  const own = document.createElement('div');
  own.className = 'question-card-own';
  const input = document.createElement('input');
  input.className = 'input flex1';
  input.placeholder = choices.length ? 'Or answer in your own words…' : 'Your answer…';
  input.onkeydown = e => { if (e.key === 'Enter' && input.value.trim()) answer(input.value.trim()); };
  const send = document.createElement('button');
  send.className = 'btn btn-sm btn-teal';
  send.textContent = 'Answer';
  send.onclick = () => { if (input.value.trim()) answer(input.value.trim()); };
  own.append(input, send);
  buttons.push(send);
  if (discuss !== false) {
    const talk = document.createElement('button');
    talk.className = 'btn btn-sm';
    talk.textContent = 'Discuss in chat';
    talk.title = 'Talk it over with the Orchestrator instead of picking an answer here';
    talk.onclick = () => chatDiscuss(discuss || question);
    own.appendChild(talk);
  }
  card.appendChild(own);

  const status = document.createElement('span');
  status.className = 'status-line';
  card.appendChild(status);

  async function answer(text) {
    for (const b of buttons) b.disabled = true;
    input.disabled = true;
    setStatus(status, `Applying “${text}”…`, '', { clear: 0 });
    try {
      const said = await onAnswer(text);
      card.classList.add('answered');
      setStatus(status, `✓ ${said || 'Done.'}`, 'ok', { clear: 0 });
    } catch (e) {
      for (const b of buttons) b.disabled = false;
      input.disabled = false;
      setStatus(status, `✗ ${e.message}`, 'err', { clear: 0 });
    }
  }
  return card;
}

/** Open the floating chat with a message ready to send — the owner edits it or sends it as it is. */
function chatDiscuss(text) {
  if (typeof chatOpen !== 'undefined' && !chatOpen) toggleChat();
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.value = text;
  input.focus();
  input.dispatchEvent(new Event('input'));
}

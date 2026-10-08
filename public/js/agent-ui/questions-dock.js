/* ═══════════════════════════════════════════════════════
   Questions the agent is waiting on the owner for (ask_device), at the desk.
   The same question is on the owner's phone and watch; whichever answers first
   is the answer (modules/harness/reach.js). Drawn above the chat button, from
   the same question card the rules review uses.
   ═══════════════════════════════════════════════════════ */

const QUESTIONS_POLL_MS = 5000;
const _qCards = new Map();   // question id -> card element

function _questionsDock() {
  let dock = document.getElementById('questions-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'questions-dock';
    dock.className = 'questions-dock';
    document.body.appendChild(dock);
  }
  return dock;
}

async function questionsPoll() {
  if (document.hidden) return;
  let list = [];
  try { list = (await apiFetch('/api/harness/questions')).questions || []; } catch { return; }
  const dock = _questionsDock();
  const open = new Set(list.map(q => q.id));
  // Answered here, on a device, or given up on: its card goes.
  for (const [id, card] of _qCards) if (!open.has(id) && !card.classList.contains('answered')) { card.remove(); _qCards.delete(id); }
  for (const q of list) {
    if (_qCards.has(q.id)) continue;
    const card = questionCardEl({
      question: q.note ? `${q.question}\n${q.note}` : q.question,
      choices: q.choices.map(c => c.label),
      discuss: false,          // the agent is waiting on this answer; a chat about it would not reach it
      onAnswer: async text => {
        const choice = q.choices.find(c => c.label === text);
        await apiFetch(`/api/harness/questions/${encodeURIComponent(q.id)}`, { method: 'POST',
          body: choice ? { choiceId: choice.id } : { text } });
        setTimeout(() => { card.remove(); _qCards.delete(q.id); _questionsBadge(); }, 4000);
        return 'Sent — the agent has it.';
      },
    });
    card.classList.add('questions-dock-card');
    _qCards.set(q.id, card);
    dock.appendChild(card);
  }
  if (typeof approvalCardEl === 'function') await _questionsApprovals(dock);
  _questionsBadge();
}

/**
 * Approval questions waiting for this person (GET /api/harness/approval `mine`): their level's card, their own budget's.
 * Drawn here when no chat on this page shows them — a reloaded page, a turn started on another device (deep test A: a
 * member's turn waited on a question they could see nowhere). A mission's machine question pops up instead (mission-ask.js).
 */
const _aCards = new Map();   // approval id -> card element
async function _questionsApprovals(dock) {
  let mine = [];
  try { mine = (await apiFetch('/api/harness/approval')).mine || []; } catch { return; }
  const open = new Set(mine.map(p => p.id));
  for (const [id, card] of _aCards) if (!open.has(id) && !card.classList.contains('settled')) { card.remove(); _aCards.delete(id); }
  for (const p of mine) {
    if (_aCards.has(p.id) || document.querySelector(`[data-approval-id="${CSS.escape(p.id)}"]`)) continue;
    const card = approvalCardEl(p, () => setTimeout(() => { card.remove(); _aCards.delete(p.id); _questionsBadge(); }, 3000));
    card.classList.add('questions-dock-card');
    _aCards.set(p.id, card);
    dock.appendChild(card);
  }
}

/** The chat button says when something is waiting for the owner. */
function _questionsBadge() {
  const fab = document.getElementById('chat-fab');
  const waiting = [..._qCards.values(), ..._aCards.values()].filter(c => !c.classList.contains('answered') && !c.classList.contains('settled')).length;
  if (fab) fab.dataset.questions = waiting ? String(waiting) : '';
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('chat-fab')) {
  setInterval(questionsPoll, QUESTIONS_POLL_MS);
  questionsPoll();
}

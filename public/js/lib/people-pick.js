/* Choosing people like a mail's To: line (asked 2026-10-10 for meetings: "a list like the email one to add members,
   auto-suggesting members and completed by clicking on them"). Chips in one field; typing suggests the people of the
   hive this person may reach (whatever list the caller gives: the hive chat's directory, a meeting's people); ↑ ↓ move,
   Enter, Tab or a click adds, Backspace in an empty field takes the last chip off. Where the caller allows it, an
   address typed out becomes a guest's chip (a meeting invites people outside the hive).
     const pick = peoplePick(host, { people, emails, placeholder, onChange })
     pick.value() → { people: [ids], emails: [addresses] }     pick.clear()     pick.add(id)
   peoplePickMatch() and peoplePickEmail() are the rules, kept apart so a test runs them without a page. */

const PP_EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** A typed address, when it is one (a pasted "Name <a@b.c>" too). */
function peoplePickEmail(q) {
  const s = String(q || '').trim().replace(/^.*<([^>]+)>\s*$/, '$1');
  return PP_EMAIL.test(s) ? s.toLowerCase() : null;
}

/** Who to suggest for `q`: not already chosen, best first — a name that starts so, then a word that does, then anywhere. */
function peoplePickMatch(people, q, chosen = [], limit = 8) {
  const n = String(q || '').trim().toLowerCase();
  const rank = p => {
    const name = String(p.name || '').toLowerCase(), more = String(p.sub || '').toLowerCase();
    if (!n) return 3;
    if (name.startsWith(n)) return 0;
    if (name.split(/[\s.\-_]+/).some(w => w.startsWith(n))) return 1;
    if (name.includes(n) || more.includes(n)) return 2;
    return -1;
  };
  return people.filter(p => !chosen.includes(p.id)).map(p => [rank(p), p]).filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || (a[1].may === false) - (b[1].may === false) || String(a[1].name).localeCompare(String(b[1].name)))
    .slice(0, limit).map(([, p]) => p);
}

function peoplePick(host, { people = [], emails = false, placeholder = 'Add people…', onChange = () => {}, label = 'People' } = {}) {
  const st = { ids: [], emails: [], active: 0, shown: [] };
  host.classList.add('pp');
  host.innerHTML = `<div class="pp-field" role="group" aria-label="${escHtml(label)}"><span class="pp-chips"></span>
      <input class="pp-input" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="${escHtml(placeholder)}" placeholder="${escHtml(placeholder)}"></div>
    <div class="pp-suggest" role="listbox" hidden></div>`;
  const field = host.querySelector('.pp-field'), chips = host.querySelector('.pp-chips'), input = host.querySelector('.pp-input'), box = host.querySelector('.pp-suggest');
  const byId = id => people.find(p => p.id === id);
  const changed = () => { drawChips(); onChange(api.value()); };

  function drawChips() {
    chips.innerHTML = st.ids.map(id => `<span class="pp-chip" data-id="${escHtml(id)}">${escHtml(byId(id)?.name || id)}<button type="button" class="pp-x" aria-label="Remove ${escHtml(byId(id)?.name || id)}">✕</button></span>`).join('')
      + st.emails.map(e => `<span class="pp-chip pp-guest" data-email="${escHtml(e)}" title="A guest: gets an invitation by mail">${escHtml(e)}<button type="button" class="pp-x" aria-label="Remove ${escHtml(e)}">✕</button></span>`).join('');
    input.placeholder = st.ids.length || st.emails.length ? '' : placeholder;
  }
  function suggest() {
    const q = input.value;
    st.shown = peoplePickMatch(people, q, st.ids);
    const mail = emails && peoplePickEmail(q) && !st.emails.includes(peoplePickEmail(q)) ? peoplePickEmail(q) : null;
    const rows = st.shown.map((p, i) => `<div class="pp-opt${i === st.active ? ' on' : ''}${p.may === false ? ' off' : ''}" role="option" data-i="${i}" aria-selected="${i === st.active}"
        ${p.may === false ? `title="${escHtml(p.why || 'Your level does not reach them')}"` : ''}><b>${escHtml(p.name)}</b>${p.sub ? `<small>${escHtml(p.sub)}</small>` : ''}</div>`);
    if (mail) rows.push(`<div class="pp-opt${st.active === st.shown.length ? ' on' : ''}" role="option" data-mail="1"><b>${escHtml(mail)}</b><small>a guest — gets an invitation by mail</small></div>`);
    if (!rows.length && q.trim()) rows.push(`<div class="pp-none">${emails ? 'Nobody here by that name — or type a whole mail address.' : 'Nobody here by that name.'}</div>`);
    box.innerHTML = rows.join('');
    box.hidden = !rows.length || document.activeElement !== input;
    input.setAttribute('aria-expanded', String(!box.hidden));
  }
  function pickAt(i) {
    const p = st.shown[i];
    if (p) { if (p.may === false) return; st.ids.push(p.id); }
    else { const mail = emails && peoplePickEmail(input.value); if (!mail) return; if (!st.emails.includes(mail)) st.emails.push(mail); }
    input.value = ''; st.active = 0; changed(); suggest(); input.focus();
  }
  input.addEventListener('input', () => {
    // A comma or semicolon ends an address typed out (or pasted as a list).
    if (emails && /[,;]/.test(input.value)) {
      const parts = input.value.split(/[,;]/); input.value = parts.pop();
      for (const part of parts) { const m = peoplePickEmail(part); if (m && !st.emails.includes(m)) st.emails.push(m); }
      changed();
    }
    st.active = 0; suggest();
  });
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150));
  input.addEventListener('keydown', e => {
    const count = box.querySelectorAll('.pp-opt').length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (count) { st.active = (st.active + (e.key === 'ArrowDown' ? 1 : count - 1)) % count; suggest(); } return; }
    if ((e.key === 'Enter' || (e.key === 'Tab' && input.value.trim())) && count) { e.preventDefault(); return pickAt(st.active); }
    if (e.key === 'Backspace' && !input.value) {
      if (st.emails.length) st.emails.pop(); else if (st.ids.length) st.ids.pop(); else return;
      e.preventDefault(); changed(); suggest();
    }
    if (e.key === 'Escape' && !box.hidden) { e.preventDefault(); e.stopPropagation(); box.hidden = true; }
  });
  box.addEventListener('mousedown', e => {
    const o = e.target.closest('.pp-opt');
    if (!o) return;
    e.preventDefault();
    pickAt(o.dataset.mail ? -1 : Number(o.dataset.i));
  });
  field.addEventListener('click', e => {
    const x = e.target.closest('.pp-x');
    if (x) {
      const c = x.closest('.pp-chip');
      if (c.dataset.id) st.ids = st.ids.filter(i => i !== c.dataset.id); else st.emails = st.emails.filter(m => m !== c.dataset.email);
      changed();
    }
    input.focus();
  });
  const api = {
    value: () => ({ people: [...st.ids], emails: [...st.emails] }),
    clear: () => { st.ids = []; st.emails = []; input.value = ''; changed(); },
    add: id => { if (byId(id) && !st.ids.includes(id)) { st.ids.push(id); changed(); } },
    setPeople: list => { people = list; drawChips(); },
    input,
  };
  drawChips();
  return api;
}

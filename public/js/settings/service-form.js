/* Field → Connectors → API services: what the form holds, in one object (asked 2026-10-10 by the owner on hi3d: "many
   clicks on different buttons clear the fields", and "I linked a skill — no Save button"). Every field the person
   types into is copied into _svcForm.values as they type (the key's boxes into _svcForm.secrets, in memory only), and
   every draw of the card — a page redrawn, a row removed, another page and back — paints the form from it, so nothing
   typed is lost to a redraw. Filling the form from somewhere else (a ready-made service, Find, a draft, Edit) never
   replaces a field the person typed without asking first.
   One rule for saving, the whole form alike: a new service has Add; a saved one shows Save (and Undo changes) the
   moment anything in it differs from what is saved — the skill linked included — and "✓ Saved" after. Nothing saves
   by itself. */
const SVC_FIELDS = ['sk-name', 'sk-origin', 'sk-note', 'sk-place', 'sk-field', 'sk-prefix', 'sk-tokenurl', 'sk-scope', 'sk-who',
  'sk-headers', 'sk-rate', 'sk-docs', 'sk-actions', 'sk-skill'];
const SVC_SECRETS = ['sk-key', 'sk-id', 'sk-secret'];
const SVC_UI = ['sa-q-services', 'sk-skill-q'];   // the boxes above and in the fold that look things up: kept, never saved
const SVC_LABELS = { 'sk-name': 'name', 'sk-origin': 'address', 'sk-note': 'what it is for', 'sk-place': 'how it signs in', 'sk-field': 'header or parameter',
  'sk-prefix': 'before the key', 'sk-tokenurl': 'token address', 'sk-scope': 'scope', 'sk-who': 'who may use it', 'sk-headers': 'extra headers',
  'sk-rate': 'rate limit', 'sk-docs': 'its docs', 'sk-actions': 'actions', 'sk-skill': 'skill', 'sk-key': 'key', 'sk-id': 'key', 'sk-secret': 'key' };

const serviceFormEmpty = () => Object.fromEntries(SVC_FIELDS.map(id => [id, { 'sk-place': 'bearer', 'sk-who': 'host' }[id] || '']));
const serviceFormBlank = () => ({ editing: null, draft: null, source: null, title: '', keyHint: '', docs: '', hasKey: false, actions: [], actionsSaid: '',
  values: serviceFormEmpty(), secrets: {}, ui: {}, saved: null, touched: [], savedAt: 0, said: '' });
let _svcForm = serviceFormBlank();

const _svcNorm = v => String(v ?? '').split('\n').map(s => s.trim()).join('\n').trim();

/** What differs from the saved service (or, for a new one, from an empty form): field ids. */
function serviceFormChanged() {
  const base = _svcForm.saved || serviceFormEmpty();
  const out = SVC_FIELDS.filter(id => _svcNorm(_svcForm.values[id]) !== _svcNorm(base[id]));
  if (SVC_SECRETS.some(id => _svcNorm(_svcForm.secrets[id]))) out.push('sk-key');
  return out;
}

/** Heard on the card: a field typed into is copied into the state (and marked as the person's). */
function serviceFormHear(e) {
  const id = e.target?.id;
  if (SVC_UI.includes(id)) { _svcForm.ui[id] = e.target.value; return; }
  if (!SVC_FIELDS.includes(id) && !SVC_SECRETS.includes(id)) return;
  if (SVC_SECRETS.includes(id)) _svcForm.secrets[id] = e.target.value;
  else {
    if (id === 'sk-place') serviceFormCarryKey(_svcForm.values['sk-place'], e.target.value);
    _svcForm.values[id] = e.target.value;
  }
  if (!_svcForm.touched.includes(id)) _svcForm.touched.push(id);   // typed, or drafted into it by the agent (form_fill)
  _svcForm.savedAt = 0;
  serviceFormFoot();
}

/** One key box ↔ two (an id and a secret): what was typed moves with the way of signing in. */
function serviceFormCarryKey(from, to) {
  const two = h => typeof SVC_TWO !== 'undefined' && !!SVC_TWO[h], s = _svcForm.secrets;
  if (two(from) === two(to)) return;
  if (two(to) && s['sk-key'] && !s['sk-id'] && !s['sk-secret']) {
    const at = s['sk-key'].indexOf(':');
    Object.assign(s, at > 0 ? { 'sk-id': s['sk-key'].slice(0, at), 'sk-secret': s['sk-key'].slice(at + 1) } : { 'sk-id': s['sk-key'] }, { 'sk-key': '' });
  } else if (!two(to) && (s['sk-id'] || s['sk-secret']) && !s['sk-key']) {
    Object.assign(s, { 'sk-key': s['sk-secret'] ? `${s['sk-id'] || ''}:${s['sk-secret']}` : s['sk-id'] || '', 'sk-id': '', 'sk-secret': '' });
  }
  for (const id of SVC_SECRETS) { const el = document.getElementById(id); if (el) el.value = s[id] || ''; }
}

/** The card was drawn (again): listen to it once, and put the state into its fields. */
function serviceFormPaint() {
  const card = document.getElementById('service-keys-card');
  if (!card || !document.getElementById('sk-name')) return;
  if (!card.dataset.svcHeard) {
    card.dataset.svcHeard = '1';
    card.addEventListener('input', serviceFormHear);
    card.addEventListener('change', serviceFormHear);
  }
  const sk = document.getElementById('sk-skill'), skill = _svcForm.values['sk-skill'];
  if (sk && skill && ![...sk.options].some(o => o.value === skill)) sk.add(new Option(skill, skill));
  for (const id of SVC_FIELDS) { const el = document.getElementById(id); if (el) el.value = _svcForm.values[id] ?? ''; }
  for (const id of SVC_SECRETS) { const el = document.getElementById(id); if (el) el.value = _svcForm.secrets[id] || ''; }
  for (const id of SVC_UI) { const el = document.getElementById(id); if (el && _svcForm.ui[id] !== undefined) el.value = _svcForm.ui[id]; }
  const said = document.getElementById('sk-actions-said');
  if (said) said.textContent = _svcForm.actionsSaid;
  serviceKeysPlace();
  advancedFoldRefresh(card);
  serviceFormFoot();
}

/** The heading and the foot: New / Editing, and Add, Save, Undo changes, ✓ Saved, New service. */
function serviceFormFoot() {
  const head = document.getElementById('sk-head'), foot = document.getElementById('sk-foot');
  const f = _svcForm, changed = serviceFormChanged();
  if (head) head.innerHTML = f.editing ? `Editing <b>${escHtml(f.editing)}</b>` : f.draft ? 'The agent\'s draft — check it, paste the key and Add' : 'New service';
  if (!foot) return;
  const names = [...new Set(changed.map(id => SVC_LABELS[id] || id))];
  const btn = (act, label, cls = '') => `<button class="btn btn-sm ${cls}" data-act="${act}" onclick="serviceFormAct('${act}')">${label}</button>`;
  if (!f.editing) {
    foot.innerHTML = `${btn('add', f.draft ? 'Add it' : 'Add service', 'btn-primary')}${changed.length ? btn('reset', 'Start over') : ''}
      ${f.said ? `<span class="desc">${f.said}</span>` : ''}`;
    return;
  }
  foot.innerHTML = changed.length
    ? `<span class="pt pt-ask"></span><span class="desc">Unsaved changes: ${escHtml(names.join(', '))}${f.values['sk-name'].trim() && f.values['sk-name'].trim().toLowerCase() !== f.editing ? ` — saved under the new name, ${escHtml(f.editing)} stays too` : ''}</span>
       ${btn('save', 'Save', 'btn-primary')}${btn('undo', 'Undo changes')}${btn('new', '＋ New service')}`
    : `<span class="desc">${f.savedAt ? '✓ Saved' : 'No changes'}</span>${btn('new', '＋ New service')}`;
}

function serviceFormAct(act) {
  if (act === 'add' || act === 'save') return serviceKeysAdd();
  if (act === 'undo') { _svcForm.values = { ..._svcForm.saved }; _svcForm.secrets = {}; _svcForm.touched = []; return serviceFormPaint(); }
  if (act === 'reset') return appConfirm('Clear the form? What you typed in it goes.', () => serviceFormNew(true));
  if (act === 'new') return serviceFormNew();
}

/** An empty form for another service — asking first when something typed is not saved. */
function serviceFormNew(sure = false) {
  const go = () => { _svcForm = { ...serviceFormBlank(), ui: _svcForm.ui }; serviceAddSay('services', ''); serviceFormPaint(); document.getElementById('sk-name')?.focus(); };
  if (sure || !serviceFormChanged().length) return go();
  appConfirm('Start a new service? Your unsaved changes here go.', go);
}

/**
 * Fill the form (serviceFill in service-keys.js decides what from). `replace` (Edit, a draft): the form becomes that
 * service — asked first when the person typed something here, and nothing happens on Cancel. Otherwise (a ready-made
 * service, Find): the fields the person typed are asked about, and Cancel keeps theirs while the rest is filled.
 */
function serviceFormLoad(values, meta, { replace = false, what = 'this' } = {}) {
  const f = _svcForm;
  const mine = f.touched.filter(id => SVC_SECRETS.includes(id) ? _svcNorm(f.secrets[id]) : _svcNorm(f.values[id]) && _svcNorm(f.values[id]) !== _svcNorm(values[id]));
  const apply = keep => {
    const kept = keep ? Object.fromEntries(mine.filter(id => SVC_FIELDS.includes(id)).map(id => [id, f.values[id]])) : {};
    _svcForm = { ...serviceFormBlank(), ...meta, values: { ...serviceFormEmpty(), ...values, ...kept }, secrets: keep ? f.secrets : {}, ui: f.ui,
      touched: keep ? mine : [], saved: meta.editing ? { ...serviceFormEmpty(), ...values } : null };
    serviceFormPaint();
  };
  if (!mine.length) return apply(false);
  const names = [...new Set(mine.map(id => SVC_LABELS[id]))].join(', ');
  if (replace) return appConfirm(`Open ${what}? What you typed here (${names}) is not saved and goes.`, () => apply(false));
  appConfirm(`Fill the form from ${what}? It would replace what you typed: ${names}. Cancel keeps yours and fills the rest.`, () => apply(false), () => apply(true));
}

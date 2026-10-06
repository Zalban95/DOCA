/* Settings → Voice → The face (asked 2026-10-06): its look for this screen — form, points, size, glow, motion, colours,
   whether concepts show — with a live preview that runs only while the editor is open, so the page does not keep a
   canvas animating behind it. Saved as this screen's `face.spec` (settings-schema; an edition carries one); the corner
   face and assistant mode read it through faceSpec(). */
let _faceEdit = null;   // {face, timer}: the preview, while open

const FACE_EDIT_FIELDS = [
  { k: 'form', label: 'Form', type: 'select', options: [['poly', 'Polyhedron of light'], ['face', 'Eyes and mouth']] },
  { k: 'dots', label: 'Points', type: 'range', min: 120, max: 1200, step: 20 },
  { k: 'point', label: 'Point size', type: 'range', min: 0.4, max: 2.5, step: 0.05 },
  { k: 'glow', label: 'Glow intensity', type: 'range', min: 0, max: 4, step: 0.05 },
  { k: 'glowRadius', label: 'Glow radius', type: 'range', min: 0.5, max: 5, step: 0.05 },
  { k: 'speed', label: 'Motion', type: 'range', min: 0.2, max: 2.5, step: 0.05 },
  { k: 'accent', label: 'Colour', type: 'color', palette: true },
  { k: 'field', label: 'Background points', type: 'color', palette: true },
  { k: 'ask', label: 'Asking you', type: 'color', palette: true },
  { k: 'concepts', label: 'Show concepts as they are said', type: 'check' },
];

async function faceEditorRender(panel) {
  document.getElementById('face-editor-card')?.remove();
  let shared = {};
  try { shared = (await screenLoad(true)).settings?.face?.spec || {}; } catch { /* the default */ }
  const spec = { ...FACE_DEFAULT, ...shared, palette: { ...FACE_DEFAULT.palette, ...(shared.palette || {}) } };
  const val = f => (f.palette ? spec.palette[f.k] : spec[f.k]);
  const input = f => f.type === 'select' ? `<select class="input" data-face="${f.k}" style="width:auto">${f.options.map(([v, l]) => `<option value="${v}" ${val(f) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
    : f.type === 'check' ? `<input type="checkbox" data-face="${f.k}" ${val(f) !== false ? 'checked' : ''}>`
    : f.type === 'color' ? `<input type="color" data-face="${f.k}" data-palette="1" value="${escHtml(val(f))}">`
    : `<input type="range" data-face="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${val(f)}" style="width:180px"><span class="face-edit-val" style="font-size:11px;min-width:36px">${val(f)}</span>`;
  const card = Object.assign(document.createElement('div'), { className: 'card', id: 'face-editor-card' });
  card.innerHTML = `<div class="card-title">The face</div>
    <p style="font-size:11px;color:var(--muted);margin-bottom:8px">How the face looks on this screen — the corner, assistant mode and the face page. Open the editor to see it change as you set it.</p>
    <details id="face-edit-details"><summary style="cursor:pointer;font-size:12px">Edit, with a preview</summary>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px">
        <canvas id="face-edit-preview" style="width:min(320px,100%);height:260px;border-radius:12px;background:#050507"></canvas>
        <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:240px">
          ${FACE_EDIT_FIELDS.map(f => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label style="font-size:11px;color:var(--muted);width:140px">${f.label}</label>${input(f)}</div>`).join('')}
          <div class="toolbar" style="gap:6px"><button class="btn btn-sm btn-blue" onclick="faceEditorSave()">Save for this screen</button>
            <button class="btn btn-sm" onclick="faceEditorSave(true)">Default</button>
            <button class="btn btn-sm" onclick="faceEditorConcept()" title="Show a concept on the preview">❄ Try a concept</button></div>
        </div></div></details>`;
  panel.append(card);
  const det = card.querySelector('#face-edit-details');
  det.addEventListener('toggle', () => (det.open ? faceEditorPreview() : faceEditorStop()));
  card.querySelectorAll('[data-face]').forEach(el => el.addEventListener('input', () => {
    const v = el.nextElementSibling; if (v?.classList.contains('face-edit-val')) v.textContent = el.value;
    clearTimeout(_faceEdit?.timer);
    if (_faceEdit) _faceEdit.timer = setTimeout(faceEditorPreview, 150);
  }));
}

/** The spec as the editor holds it. */
function faceEditorSpec() {
  const spec = { palette: {} };
  document.querySelectorAll('#face-editor-card [data-face]').forEach(el => {
    const k = el.dataset.face;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    if (el.dataset.palette) spec.palette[k] = v; else spec[k] = v;
  });
  return spec;
}

function faceEditorPreview() {
  faceEditorStop();
  const canvas = document.getElementById('face-edit-preview');
  if (!canvas) return;
  const face = faceMount(canvas, { ...faceEditorSpec(), hud: false });
  face.set('listening');
  _faceEdit = { face, timer: null };
}

function faceEditorStop() { if (_faceEdit) { clearTimeout(_faceEdit.timer); _faceEdit.face.stop(); _faceEdit = null; } }

function faceEditorConcept() {
  if (!_faceEdit || typeof faceGlyphPoints !== 'function') return;
  const c = faceConceptFor('snow') || { glyph: '❄', color: '#9fd8ff' };
  const pts = faceGlyphPoints(c.glyph);
  if (pts) _faceEdit.face.shape(pts, c.color, 3500);
}

async function faceEditorSave(reset) {
  try {
    await screenSave({ face: reset ? null : { spec: faceEditorSpec() } });
    try { localStorage.removeItem('doca.face.spec'); } catch { /* this browser's own copy no longer overrides it */ }
  } catch (e) { return appAlert(e.message); }
  if (typeof faceCornerReload === 'function') faceCornerReload();
  faceEditorStop();
  faceEditorRender(document.getElementById('sp-voice'));
}

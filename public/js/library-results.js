/* The Library's results, drawn the same in Files ("Search by meaning") and in the Library section's try box
   (modules/library/search.js): a thumbnail for a picture or a video's matching frame, a waveform for sound with the
   matching moment marked, the kind, the name and folder, the mechanical description, the tags as chips (a click
   narrows the search to them), a caption marked as the model's, and Open (at the moment that matched) and Like this. */

const LIB_KIND = { documents: '📄 document', images: '🖼 picture', audio: '🔊 audio', video: '🎞 video' };
const _libClock = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const _libFile = (p, q = '') => `/api/library/file?path=${encodeURIComponent(p)}${q}`;

/** A small waveform from the peaks the indexer measured, with the matching stretch marked. */
function libraryWave(peaks, duration, at, end) {
  if (!peaks?.length) return '<div class="lib-thumb lib-thumb-none">🔊</div>';
  const w = 120, h = 40, bw = w / peaks.length;
  const mark = duration && at != null ? `<rect x="${(at / duration) * w}" y="0" width="${Math.max(2, (((end ?? at + 1) - at) / duration) * w)}" height="${h}" class="lib-wave-mark"/>` : '';
  return `<svg class="lib-thumb lib-wave" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${mark}${peaks.map((p, i) =>
    `<rect x="${i * bw + 0.5}" y="${(h - Math.max(1, (p / 100) * h)) / 2}" width="${Math.max(1, bw - 1)}" height="${Math.max(1, (p / 100) * h)}"/>`).join('')}</svg>`;
}

function _libThumb(r) {
  const at = r.match?.at;
  if (r.kind === 'images') return `<img class="lib-thumb" alt="" src="${_libFile(r.path, '&thumb=1')}">`;
  if (r.kind === 'video') return `<img class="lib-thumb" alt="" src="${_libFile(r.path, at != null ? `&frame=${at}` : '&thumb=1')}">`;
  if (r.kind === 'audio') return libraryWave(r.meta?.peaks, r.meta?.duration, at, r.match?.end);
  return '<div class="lib-thumb lib-thumb-none">📄</div>';
}

/** One result row; `ctx` names the box whose search a tag chip narrows. */
function libraryResultHtml(r, ctx = '') {
  const m = r.match, at = m?.at != null ? ` at ${_libClock(m.at)}` : '';
  const how = m ? { transcript: `words said${at}`, frame: `a frame${at}`, audio: `the sound${at}`, image: 'the picture', caption: 'its caption', text: 'its text' }[m.kind] || m.kind : 'its name or tags';
  const dir = r.path.slice(0, r.path.length - r.name.length);
  return `<div class="lib-result" data-path="${escHtml(r.path)}">
    ${_libThumb(r)}
    <div class="lib-body">
      <div class="lib-name"><span class="badge">${LIB_KIND[r.kind] || escHtml(r.kind)}</span> <b>${escHtml(r.name)}</b> <span class="ww-dim">${escHtml(dir)}</span></div>
      <div class="ww-dim">${escHtml(r.about || '')}</div>
      <div class="ww-dim">${r.similar ? 'like it' : `matched by ${escHtml(how)}`}${r.score != null ? ` · ${r.score}` : ''}${m?.text && m.kind !== 'caption' ? ` — “${escHtml(m.text.slice(0, 160))}”` : ''}</div>
      ${r.caption ? `<div class="lib-caption" title="Written by the vision model">✎ ${escHtml(r.caption)}</div>` : ''}
      ${(r.tags || []).length ? `<div class="lib-tags">${r.tags.map(t => `<button class="lib-tag" title="score ${t.score} — show only files with this tag" onclick="libraryTagFilter('${escHtml(ctx)}','${escHtml(t.tag)}')">${escHtml(t.tag)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="lib-acts">
      <button class="btn btn-xs" onclick="libraryOpen(this)" data-kind="${escHtml(r.kind)}" data-at="${m?.at ?? ''}">Open${at}</button>
      <button class="btn btn-xs" onclick="librarySimilar(this, '${escHtml(ctx)}')" title="Files like this one, near-duplicates first">Like this</button>
    </div></div>`;
}

function libraryResultsHtml(list, ctx = '', note = '') {
  if (!list?.length) return `<div class="placeholder">${escHtml(note || 'Nothing found.')}</div>`;
  return list.map(r => libraryResultHtml(r, ctx)).join('');
}

/** Open a result in the page's media viewer, at the moment that matched (a media fragment, #t=). */
function libraryOpen(btn) {
  const row = btn.closest('.lib-result'), p = row.dataset.path, kind = btn.dataset.kind, at = btn.dataset.at;
  const name = p.split(/[\\/]/).pop();
  const viewKind = { images: 'image', audio: 'audio', video: 'video' }[kind];
  if (viewKind && typeof mediaViewerOpen === 'function') return mediaViewerOpen({ src: _libFile(p) + (at ? `#t=${at}` : ''), kind: viewKind, name });
  window.open(_libFile(p), '_blank', 'noopener');
}

/** Files like the one in this row, drawn in its box's results. */
async function librarySimilar(btn, ctx) {
  const out = document.getElementById(ctx === 'files' ? 'lib-files-results' : 'lib-try-out');
  const p = btn.closest('.lib-result').dataset.path;
  if (!out) return;
  out.innerHTML = '<div class="placeholder pulse">Looking for files like it…</div>';
  try {
    const r = await apiFetch(`/api/library/similar?path=${encodeURIComponent(p)}`);
    out.innerHTML = `<div class="ww-dim">Files like ${escHtml(p.split(/[\\/]/).pop())} — near-duplicates first:</div>`
      + libraryResultsHtml(r.results.map(x => ({ ...x, similar: true, about: `${x.near ? 'near-duplicate · ' : ''}${x.about}`, meta: {} })), ctx, 'No other file is like it.');
  } catch (e) { out.innerHTML = `<div class="placeholder">${escHtml(e.message)}</div>`; }
}

/** A tag chip narrows its box's search to files with that tag. */
function libraryTagFilter(ctx, tag) {
  const input = document.getElementById(ctx === 'files' ? 'lib-files-tags' : 'lib-try-tags');
  if (!input) return;
  const have = input.value.split(',').map(s => s.trim()).filter(Boolean);
  if (!have.includes(tag)) input.value = [...have, tag].join(', ');
  if (ctx === 'files') libraryFilesSearch(); else libraryTry();
}

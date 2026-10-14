/* Opening Files at a file's own place (asked 2026-10-14): a search result opened the home folder, because the tab's
   first load went home after the search had asked for the file's folder. fmShow asks first; fmInit starts there
   (fm.wanted) and the list, once drawn, selects the file and brings it into view. */
/**
 * Open the Files tab at a file's own folder with that file selected and in view, or at a folder (a search result,
 * 2026-10-14: it opened the home folder, as the tab's first load went home after the search had asked for the folder).
 */
async function fmShow(filePath, isDir = false) {
  const dir = isDir ? filePath : (filePath.replace(/[\\/][^\\/]*$/, '') || '/');
  fm.wanted = { path: dir, select: isDir ? null : filePath };
  nav('files');
  // A tab already drawn navigates here; a first one starts here from fmInit, which reads fm.wanted.
  if (document.getElementById('fm-bookmarks-list')?.children.length) await fmNavigate(dir);
}

/** After a list is drawn: the file a search asked for, selected and in view, once. */
function fmWantedSelect() {
  const w = fm.wanted;
  if (!w || fm.cwd !== w.path) return;
  fm.wanted = null;
  if (!w.select) return;
  const row = [...document.querySelectorAll('.fm-row')].find(r => r.dataset.path === w.select);
  if (!row) return;
  fm.selected = new Set([w.select]);
  row.classList.add('selected');
  row.scrollIntoView({ block: 'center' });
  if (typeof fmUpdateStatus === 'function') fmUpdateStatus();
}

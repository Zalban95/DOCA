/* ═══════════════════════════════════════════════════════
   Projects → code intelligence: a small Language Server Protocol client for
   the Monaco editor (modules/projects/lsp.js bridges to the server).

   What it wires: problems as you type (diagnostics → Monaco markers), hover,
   completion, and go to definition (F12 / Ctrl+click, opening the file). One
   connection per project and server, started the first time a file of its
   language is opened, only when that server is on this machine.
   ═══════════════════════════════════════════════════════ */

const PJL = { servers: null, conns: new Map(), providers: new Set() };

const PJL_LANG = { typescript: 'typescript', javascript: 'typescript', python: 'python', go: 'go', rust: 'rust', c: 'c', cpp: 'c', kotlin: 'kotlin', java: 'java' };

async function _pjlServers(force) {
  if (!PJL.servers || force) {
    try { PJL.servers = (await apiFetch('/api/projects/lsp/servers')).servers; } catch { PJL.servers = []; }
  }
  return PJL.servers;
}

/** The connection for this project and server, opened and initialised once. */
function _pjlConn(server) {
  const key = `${PJ.project.project.id}|${server}`;
  if (PJL.conns.has(key)) return PJL.conns.get(key);
  const root = PJ.project.project.root;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/lsp?project=${encodeURIComponent(PJ.project.project.id)}&server=${server}`);
  const c = { ws, server, seq: 0, pending: new Map(), versions: new Map(), caps: {}, ready: null };
  const send = msg => ws.send(JSON.stringify({ jsonrpc: '2.0', ...msg }));
  c.request = (method, params) => new Promise((resolve, reject) => {
    const id = ++c.seq;
    c.pending.set(id, { resolve, reject });
    send({ id, method, params });
    setTimeout(() => { if (c.pending.delete(id)) resolve(null); }, 15000);
  });
  c.notify = (method, params) => send({ method, params });
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id != null && c.pending.has(m.id)) { const p = c.pending.get(m.id); c.pending.delete(m.id); return m.error ? p.resolve(null) : p.resolve(m.result); }
    if (m.id != null && m.method) return send({ id: m.id, result: m.method === 'workspace/configuration' ? (m.params?.items || []).map(() => null) : null });   // server → client requests
    if (m.method === 'textDocument/publishDiagnostics') _pjlDiagnostics(m.params);
  };
  c.ready = new Promise(resolve => {
    ws.onopen = async () => {
      const r = await c.request('initialize', { processId: null, rootUri: `file://${root}`, workspaceFolders: [{ uri: `file://${root}`, name: PJ.project.project.name }],
        capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] }, completion: { completionItem: { snippetSupport: true } },
          definition: {}, publishDiagnostics: {}, synchronization: { didSave: true } }, workspace: { configuration: true } } });
      c.caps = r?.capabilities || {};
      c.notify('initialized', {});
      resolve(c);
    };
  });
  ws.onclose = () => { PJL.conns.delete(key); for (const p of c.pending.values()) p.resolve(null); };
  PJL.conns.set(key, c);
  return c;
}

/** Called when a file opens in the editor: attach it to its language server, if one is here. */
async function pjLspAttach(model) {
  const server = PJL_LANG[model.getLanguageId()];
  if (!server || !PJ.project) return;
  const s = (await _pjlServers()).find(x => x.name === server);
  if (!s?.found) return;
  const c = _pjlConn(server);
  await c.ready;
  const uri = model.uri.toString();
  c.versions.set(uri, 1);
  c.notify('textDocument/didOpen', { textDocument: { uri, languageId: model.getLanguageId(), version: 1, text: model.getValue() } });
  model.onDidChangeContent(() => {
    const v = (c.versions.get(uri) || 1) + 1;
    c.versions.set(uri, v);
    c.notify('textDocument/didChange', { textDocument: { uri, version: v }, contentChanges: [{ text: model.getValue() }] });
  });
  model.onWillDispose(() => { c.notify('textDocument/didClose', { textDocument: { uri } }); c.versions.delete(uri); });
  _pjlProviders(model.getLanguageId(), server);
}

const _pos = p => ({ line: p.lineNumber - 1, character: p.column - 1 });
const _range = r => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const _conn = (model, server) => PJL.conns.get(`${PJ.project?.project.id}|${server}`);

function _pjlDiagnostics({ uri, diagnostics }) {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!model) return;
  const sev = [0, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
  monaco.editor.setModelMarkers(model, 'lsp', (diagnostics || []).map(d => ({
    startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
    message: d.message, severity: sev[d.severity || 1] || monaco.MarkerSeverity.Error, source: d.source,
  })));
}

/** Hover, completion and definition for a Monaco language, answered by its server. Registered once. */
function _pjlProviders(lang, server) {
  if (PJL.providers.has(lang)) return;
  PJL.providers.add(lang);
  const doc = model => ({ uri: model.uri.toString() });
  monaco.languages.registerHoverProvider(lang, {
    provideHover: async (model, position) => {
      const c = _conn(model, server); if (!c) return null;
      const r = await c.request('textDocument/hover', { textDocument: doc(model), position: _pos(position) });
      if (!r?.contents) return null;
      const parts = [].concat(r.contents).map(x => (typeof x === 'string' ? x : x.value || '')).filter(Boolean);
      return { contents: parts.map(value => ({ value })), range: r.range ? _range(r.range) : undefined };
    },
  });
  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', ':', '<', '"', '/', '@'],
    provideCompletionItems: async (model, position) => {
      const c = _conn(model, server); if (!c) return { suggestions: [] };
      const r = await c.request('textDocument/completion', { textDocument: doc(model), position: _pos(position) });
      const items = Array.isArray(r) ? r : r?.items || [];
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return { suggestions: items.slice(0, 200).map(it => ({
        label: it.label, kind: Math.max(0, (it.kind || 1) - 1), detail: it.detail,
        documentation: typeof it.documentation === 'string' ? it.documentation : it.documentation?.value,
        insertText: it.textEdit?.newText ?? it.insertText ?? it.label,
        insertTextRules: it.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        range: it.textEdit?.range ? _range(it.textEdit.range) : range, sortText: it.sortText, filterText: it.filterText,
      })) };
    },
  });
  monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition: async (model, position) => {
      const c = _conn(model, server); if (!c) return null;
      const r = await c.request('textDocument/definition', { textDocument: doc(model), position: _pos(position) });
      const locs = [].concat(r || []).map(l => ({ uri: l.targetUri || l.uri, range: l.targetSelectionRange || l.range })).filter(l => l.uri && l.range);
      // A definition in another file: open it in a tab, at the place.
      const other = locs.find(l => l.uri !== model.uri.toString());
      if (other && locs.length === 1) {
        pjOpenFile(decodeURIComponent(monaco.Uri.parse(other.uri).path), other.range.start.line + 1, other.range.start.character + 1);
        return null;
      }
      return locs.map(l => ({ uri: monaco.Uri.parse(l.uri), range: _range(l.range) }));
    },
  });
}

/** Build & test view: the code intelligence servers, found or installable. */
async function pjLspSection(body) {
  const servers = await _pjlServers(true);
  body.appendChild(Object.assign(document.createElement('div'), { className: 'pj-res-file', textContent: 'Code intelligence' }));
  for (const s of servers) {
    const row = document.createElement('div');
    row.className = `pj-tc ${s.found ? 'ok' : 'missing'}`;
    row.textContent = `${s.found ? '✓' : '✗'} ${s.label}`;
    if (!s.found && s.installable) {
      const b = Object.assign(document.createElement('button'), { className: 'btn btn-xs', textContent: 'Install', title: 'Into DOCA\'s data folder — no sudo, nothing global' });
      b.style.marginLeft = '8px';
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Installing…';
        try { await apiFetch(`/api/projects/lsp/servers/${s.name}/install`, { method: 'POST' }); pjView('run'); }
        catch (e) { appAlert(e.message); b.disabled = false; b.textContent = 'Install'; }
      };
      row.appendChild(b);
    }
    body.appendChild(row);
  }
}

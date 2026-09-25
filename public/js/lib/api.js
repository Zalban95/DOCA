/* ═══════════════════════════════════════════════════════
   Talking to the panel's own API: JSON requests, SSE streams, and a
   streamed response written into an element.
   ═══════════════════════════════════════════════════════ */

/* ── Signed in, and staying so ─────────────────────────
   Every request the page makes goes through here (window.fetch is wrapped
   once), so a session that ended or a sign-in that is too old for the machine
   itself is handled in one place rather than as a red error in whichever card
   happened to ask. See modules/auth/gate.js for the codes. */

// Only in a browser: tests load these scripts into a sandbox with no window.
const _rawFetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null;
let _stepUp = null;   // one password prompt at a time, however many requests hit it

function _toLogin() {
  location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
  return new Promise(() => {});   // the page is leaving; nothing after this should run
}

/** Ask for the password once and renew the recent sign-in. Resolves true when renewed. */
function _renewSignIn() {
  if (_stepUp) return _stepUp;
  _stepUp = new Promise(resolve => {
    const ask = message => appPrompt(message, async password => {
      const r = await _rawFetch('/api/auth/step-up', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }) });
      if (r.ok) return resolve(true);
      const d = await r.json().catch(() => ({}));
      ask(`${d.error || 'That did not work.'} Your password:`);
    }, '', { secret: true });
    ask('This touches the machine itself, and it has been a while since you signed in. Your password:');
  }).finally(() => { _stepUp = null; });
  return _stepUp;
}

if (_rawFetch) window.fetch = async (input, init) => {
  const res = await _rawFetch(input, init);
  if (res.status !== 401 && res.status !== 403) return res;
  const url = typeof input === 'string' ? input : input?.url || '';
  if (!url.startsWith('/') || url.startsWith('/api/auth/')) return res;
  const code = await res.clone().json().then(d => d.code, () => null);
  if (code === 'unauthenticated' || code === 'setup_required' || code === 'password_change_required') return _toLogin();
  if (code === 'step_up_required' && await _renewSignIn()) return _rawFetch(input, init);
  return res;
};

/**
 * Before opening a shell socket: a WebSocket cannot ask for the password, so a
 * host route is asked first and the wrapper above prompts if it has to.
 */
async function hostAllowed() {
  try { return (await fetch('/api/auth/host-check', { cache: 'no-store' })).ok; } catch { return false; }
}

/**
 * Fetch JSON from the API. Throws on HTTP errors.
 * @param {string} url
 * @param {{method?:string, body?:object}} opts
 */
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  if (text.trimStart().startsWith('<'))
    throw new Error('Server returned HTML — run: git pull && sudo systemctl restart openclaw-panel');
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error(`Bad JSON from ${url}: ${e.message}`); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/**
 * POST JSON to an SSE endpoint and dispatch parsed `data: {...}` events.
 * Uses buffered decoding so events split across chunks are handled correctly.
 *
 * @param {string} url
 * @param {object|null} body - JSON body (null/undefined for empty POST)
 * @param {{
 *   method?:  string,                    - HTTP method (default POST)
 *   onEvent?: (obj: object) => void,     - every parsed event object
 *   onStatus?:(text: string) => void,    - convenience: obj.status chunks
 *   onDone?:  (obj: object) => void,     - event with truthy obj.done
 *   onError?: (err: Error) => void,      - network/stream failure
 * }} handlers
 * @returns {Promise<void>} resolves when the stream ends
 */
async function sseStream(url, body, handlers = {}) {
  const { method, onEvent, onStatus, onDone, onError, signal } = handlers;
  try {
    const res = await fetch(url, {
      method:  method || 'POST',
      headers: body != null ? { 'Content-Type': 'application/json' } : {},
      body:    body != null ? JSON.stringify(body) : undefined,
      // Aborting here closes the response stream, which is what the server is
      // listening for: every SSE handler that drives a turn ties res.on('close')
      // to the turn's own AbortController. So Stop is not a message we send —
      // it is us hanging up, and the turn notices.
      signal,
    });
    if (!res.ok && !res.body) throw new Error(res.statusText);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                       // keep partial line for next chunk
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let obj;
        try { obj = JSON.parse(line.slice(6)); } catch { continue; }
        if (onEvent) onEvent(obj);
        if (typeof obj === 'string') {           // plain-string payloads (e.g. log lines)
          if (onStatus) onStatus(obj);
          continue;
        }
        if (onStatus && obj.status !== undefined) onStatus(obj.status);
        if (onDone && obj.done) onDone(obj);
      }
    }
  } catch (e) {
    // Hanging up on purpose is not an error. Without this every Stop paints a
    // red "The user aborted a request" under the answer it just stopped.
    if (e.name === 'AbortError') return;
    if (onError) onError(e); else throw e;
  }
}

/**
 * Pipe an SSE response body into an element, then call onDone.
 * @param {Response} res
 * @param {HTMLElement} el
 * @param {Function|null} onDone
 */
function streamToEl(res, el, onDone) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) { if (onDone) onDone(); return; }
      const text = decoder.decode(value);
      text.split('\n').forEach(line => {
        if (line.startsWith('data: ')) {
          try { el.textContent += JSON.parse(line.slice(6)); } catch {}
        }
      });
      el.scrollTop = el.scrollHeight;
      read();
    });
  }
  read();
}

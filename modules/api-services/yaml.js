'use strict';

/**
 * YAML as OpenAPI documents are written (api-services/openapi.js reads them): block mappings and sequences by
 * indentation, a sequence item that opens a mapping (`- name: x`), plain, single- and double-quoted scalars (a plain
 * or quoted one may run over several lines), block scalars (`|`, `>`, with `-`/`+`), flow collections (`[a, b]`,
 * `{a: 1}`), comments, `---`, anchors and aliases (`&a`, `*a`, `<<: *a`), and tags left out (`!!str`). Enough for
 * the specifications providers publish; no dependency. Anything it cannot read is an error with its line, never a
 * guess.
 */
const bad = (msg, line) => Object.assign(new Error(line ? `YAML, line ${line}: ${msg}` : `YAML: ${msg}`), { status: 400 });

/** A line's text without a trailing comment (a # after a space, outside quotes). */
function uncomment(t) {
  let q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) { if (q === "'" && t[i + 1] === "'") i++; else q = null; } else if (c === '\\' && q === '"') i++; continue; }
    if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,-]/.test(t[i - 1]))) q = c;
    else if (c === '#' && (i === 0 || /\s/.test(t[i - 1]))) return t.slice(0, i).trimEnd();
  }
  return t.trimEnd();
}

/** Where a mapping key ends: the first `: ` (or a final `:`) outside quotes and brackets; -1 when this is no key. */
function keyEnd(t) {
  let q = null, depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') i++; continue; }
    if ((c === '"' || c === "'") && i === 0) { q = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i === t.length - 1 || /\s/.test(t[i + 1]))) return i;
  }
  return -1;
}

/** A quoted scalar's line breaks folded: one is a space, each empty line a newline; `\\` at a line's end joins it (double quotes). */
function folded(body, dq) {
  if (!body.includes('\n')) return body;
  const ls = body.split('\n');
  let out = '';
  for (let k = 0; k < ls.length; k++) {
    let l = k === 0 ? ls[k] : ls[k].replace(/^[ \t]+/, '');
    const last = k === ls.length - 1;
    if (!last) l = dq && /(^|[^\\])(\\\\)*\\$/.test(l) ? l : l.replace(/[ \t]+$/, '');
    if (k > 0) {
      if (ls[k].trim() === '' && !last) { out += '\n'; continue; }
      if (dq && /(^|[^\\])(\\\\)*\\$/.test(out)) out = out.slice(0, -1);
      else if (!out.endsWith('\n')) out += ' ';
    }
    out += l;
  }
  return out;
}

const ESC = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' };
function unescape(t) {
  return t.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, e) => {
    if (/^[xuU]/.test(e) && e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16));
    if (e in ESC) return ESC[e];
    throw bad(`an unknown escape \\${e} in a double-quoted string`);
  });
}

function scalar(s, anchors) {
  s = s.trim().replace(/^!!?[\w/:.-]*\s*/, '');
  if (s.startsWith('*')) { const a = s.slice(1).trim(); if (!(a in anchors)) throw bad(`unknown alias *${a}`); return anchors[a]; }
  if (s.startsWith('"')) return unescape(folded(s.slice(1, s.lastIndexOf('"')), true));
  if (s.startsWith("'")) return folded(s.slice(1, s.lastIndexOf("'")), false).replace(/''/g, "'");
  if (s.startsWith('[') || s.startsWith('{')) { const r = flow(s, 0, anchors); return r.value; }
  if (s === '' || s === '~' || /^null$/i.test(s)) return null;
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^[-+]?(0|[1-9]\d*)$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** A flow collection or scalar starting at `i`: { value, i } with `i` past it. */
function flow(s, i, anchors) {
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  ws();
  if (s[i] === '[' || s[i] === '{') {
    const close = s[i] === '[' ? ']' : '}', list = close === ']';
    const out = list ? [] : {};
    i++;
    for (;;) {
      ws();
      if (s[i] === close) { i++; break; }
      if (i >= s.length) throw bad(`a ${list ? '[' : '{'} is never closed`);
      if (list) { const r = flow(s, i, anchors); out.push(r.value); i = r.i; }
      else {
        const k = flow(s, i, anchors); i = k.i; ws();
        let v = null;
        if (s[i] === ':') { i++; const r = flow(s, i, anchors); v = r.value; i = r.i; }
        out[String(k.value)] = v;
      }
      ws();
      if (s[i] === ',') i++;
    }
    return { value: out, i };
  }
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i];
    let j = i + 1;
    for (; j < s.length; j++) { if (s[j] === '\\' && q === '"') { j++; continue; } if (s[j] === q) { if (q === "'" && s[j + 1] === "'") { j++; continue; } break; } }
    return { value: scalar(s.slice(i, j + 1), anchors), i: j + 1 };
  }
  let j = i;
  while (j < s.length && !/[,\]}]/.test(s[j]) && !(s[j] === ':' && /[\s,\]}]/.test(s[j + 1] || ' '))) j++;
  return { value: scalar(s.slice(i, j), anchors), i: j };
}

function parse(src) {
  const raw = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (let n = 0; n < raw.length; n++) {
    const r = raw[n];
    if (/^---(\s|$)/.test(r)) { if (lines.some(l => !l.blank)) break; continue; }
    if (/^\.\.\.(\s|$)/.test(r)) break;
    if (/\t/.test(r.match(/^\s*/)[0])) throw bad('a tab in the indentation', n + 1);
    const text = r.trim() === '' || /^\s*#/.test(r) ? '' : r.replace(/^ +/, '');
    lines.push({ n: n + 1, raw: r, indent: r.length - r.replace(/^ +/, '').length, text, blank: !text });
  }
  const anchors = {};
  let i = 0;
  const skip = () => { while (i < lines.length && lines[i].blank) i++; };
  const isItem = t => t === '-' || t.startsWith('- ');

  function block(indent) {
    skip();
    if (i >= lines.length || lines[i].indent < indent) return null;
    return isItem(lines[i].text) ? seq(lines[i].indent) : map(lines[i].indent);
  }

  /** What follows a key's `:` or an item's `- `: a value on the line, a block below it, or a block scalar. */
  function value(rest, ownIndent, line) {
    rest = uncomment(rest).trim();
    let anchor = null;
    const am = /^&([^\s]+)\s*/.exec(rest);
    if (am) { anchor = am[1]; rest = rest.slice(am[0].length); }
    rest = rest.replace(/^!!?[\w/:.-]*(\s+|$)/, '');
    let v;
    if (rest === '') {
      skip();
      const nx = lines[i];
      if (nx && nx.indent > ownIndent && /^[[{]/.test(nx.text)) {   // a flow collection written on the lines below
        let s = '';
        while (i < lines.length && (s === '' || !balanced(s))) { if (!lines[i].blank) s += ` ${uncomment(lines[i].text)}`; i++; }
        v = scalar(s, anchors);
      } else if (nx && (nx.indent > ownIndent || (nx.indent === ownIndent && isItem(nx.text) && line.key))) v = block(nx.indent);
      else v = null;
    } else if (/^[|>][-+0-9]*$/.test(rest)) v = blockScalar(rest, ownIndent);
    else if ((rest[0] === '[' || rest[0] === '{') && !balanced(rest)) {
      let s = rest;
      while (!balanced(s) && i < lines.length) { s += ` ${uncomment(lines[i].text)}`; i++; }
      v = scalar(s, anchors);
    } else if ((rest[0] === '"' || rest[0] === "'") && !closedQuote(rest)) {
      let s = rest;
      while (!closedQuote(s) && i < lines.length) { s += `\n${lines[i].blank ? '' : lines[i].raw}`; i++; }
      v = scalar(s, anchors);
    } else {
      let s = rest;
      // a plain scalar continued on more-indented lines, folded with spaces
      while (i < lines.length && !lines[i].blank && lines[i].indent > ownIndent && !/^[[{"'&*!|>]/.test(rest)) { s += ` ${uncomment(lines[i].text)}`; i++; }
      v = scalar(s, anchors);
    }
    if (anchor) anchors[anchor] = v;
    return v;
  }

  function blockScalar(head, ownIndent) {
    const keep = head.includes('+'), strip = head.includes('-'), fold = head[0] === '>';
    const digit = /[1-9]/.exec(head);
    let ind = digit ? ownIndent + Number(digit[0]) : null;
    const body = [];
    while (i < lines.length) {
      const l = lines[i], empty = l.raw.trim() === '';   // a "# …" line inside is text, not a comment
      if (!empty) { if (ind === null) ind = l.indent; if (l.indent < ind || l.indent <= ownIndent) break; }
      body.push(empty ? (ind !== null && l.raw.length > ind ? l.raw.slice(ind) : '') : l.raw.slice(ind));   // spaces past the indentation are text
      i++;
    }
    let trailing = 0;
    while (body.length && body[body.length - 1].trim() === '') { body.pop(); trailing++; }
    let text = '';
    if (!fold) text = body.join('\n');
    else {
      let started = false, blanks = 0, prevMore = false;
      for (const l of body) {
        if (l.trim() === '') { blanks++; continue; }
        const more = /^[ \t]/.test(l);
        if (!started) text += '\n'.repeat(blanks);
        else if (!blanks) text += more || prevMore ? '\n' : ' ';
        else text += '\n'.repeat(blanks + (more || prevMore ? 1 : 0));
        text += l; started = true; blanks = 0; prevMore = more;
      }
    }
    if (!body.length) return keep ? '\n'.repeat(trailing) : '';
    return strip ? text : `${text}\n${keep ? '\n'.repeat(trailing) : ''}`;
  }

  function map(indent) {
    const out = {};
    while (true) {
      skip();
      const l = lines[i];
      if (!l || l.indent < indent) break;
      if (l.indent > indent) throw bad('indented more than the keys before it', l.n);
      if (isItem(l.text)) break;
      const t = uncomment(l.text), k = keyEnd(t);
      if (k < 0) throw bad(`expected "key: value", found "${t.slice(0, 40)}"`, l.n);
      const key = scalar(t.slice(0, k), anchors);
      i++;
      const v = value(t.slice(k + 1), indent, { key: true, n: l.n });
      if (key === '<<') Object.assign(out, ...[].concat(v).filter(x => x && typeof x === 'object'));
      else out[String(key)] = v;
    }
    return out;
  }

  function seq(indent) {
    const out = [];
    while (true) {
      skip();
      const l = lines[i];
      if (!l || l.indent !== indent || !isItem(l.text)) break;
      const rest = l.text === '-' ? '' : l.text.slice(2);
      const pad = l.text === '-' ? 0 : 2 + (rest.length - rest.trimStart().length);
      const body = rest.trimStart();
      if (body && (isItem(body) || (keyEnd(uncomment(body)) >= 0 && !/^[[{&]/.test(body)))) {
        lines[i] = { ...l, indent: indent + pad, text: body };   // "- key: v" opens a mapping at the key's column
        out.push(block(indent + pad));
      } else { i++; out.push(value(body, indent, { n: l.n })); }
    }
    return out;
  }

  const doc = block(0);
  skip();
  if (i < lines.length) throw bad('this line is outside the document\'s structure', lines[i].n);
  return doc;
}

function balanced(s) { let d = 0, q = null; for (const c of s) { if (q) { if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--; } return d <= 0; }
function closedQuote(s) { const q = s[0]; for (let j = 1; j < s.length; j++) { if (s[j] === '\\' && q === '"') { j++; continue; } if (s[j] === q) { if (q === "'" && s[j + 1] === "'") { j++; continue; } return true; } } return false; }

/** A document as JSON or YAML (JSON first: every JSON document is YAML, and JSON.parse is exact). */
function read(text) {
  const t = String(text || '').trim();
  if (!t) throw bad('the document is empty');
  if (/^[{[]/.test(t)) { try { return JSON.parse(t); } catch { /* flow YAML, or broken JSON: the YAML reader says where */ } }
  return parse(t);
}

module.exports = { parse, read };

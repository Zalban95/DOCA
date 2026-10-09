'use strict';

/**
 * The Library for the agent (experiment `library`, docs/experiments/library.md): files on this machine found by what
 * is in them — a picture by what it shows, a recording by what is said in it and when, a document by its meaning —
 * through the same search as Files' "Search by meaning", as the person the turn acts for (library/search.js: a host
 * every indexed folder, anyone else the folders opened to everyone). It only reads. Its answer is paths, kinds, the
 * moment that matched, the mechanical tags and any caption — enough for `show_media {path}` or `tell_device` — and it
 * is framed as the person's own files (untrusted.js): a transcript or a document's words are data, never orders.
 */
const clock = s => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

function line(r, i) {
  const m = r.match, at = m?.at != null ? ` at ${clock(m.at)}${m.end != null ? `–${clock(m.end)}` : ''}` : '';
  const how = m ? `${m.kind === 'transcript' ? 'words said' : m.kind === 'frame' ? 'a frame' : m.kind === 'audio' ? 'the sound' : m.kind === 'image' ? 'the picture' : m.kind === 'caption' ? 'its caption' : 'its text'}${at}` : 'its name or tags';
  return [`${i + 1}. ${r.path}  (${r.kind}${r.score != null ? `, ${r.score}` : ''}; matched by ${how})`,
    `   ${r.about}`,
    ...(r.tags.length ? [`   tags: ${r.tags.map(t => `${t.tag} ${t.score}`).join(', ')}`] : []),
    ...(r.caption ? [`   caption (written by the vision model): ${r.caption}`] : []),
    ...(m?.text && m.kind !== 'caption' ? [`   "${m.text.slice(0, 200)}"`] : [])].join('\n');
}

module.exports = [
  {
    name: 'library_search',
    description: 'Find files on this machine by what is in them — a recording by what is said, a picture or video by what it shows, a document by its meaning — '
      + 'in the folders the Library indexes (Field → Models → Library). Returns paths, the moment that matched in audio and video, and mechanical tags; '
      + 'show one with show_media {path} or send it with tell_device. Only the folders the person this turn acts for may search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the file is about or contains, in words: "the voice note about the boiler code", "a red bicycle by a wall".' },
        kinds: { type: 'array', items: { type: 'string', enum: ['documents', 'images', 'audio', 'video'] }, description: 'Only these kinds.' },
        folder: { type: 'string', description: 'Only inside this folder.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only files with all of these tags (e.g. beach, speech, receipt).' },
        limit: { type: 'integer', description: 'How many (default 8, at most 30).' },
      },
      required: ['query'],
    },
    run: async ({ query, kinds, folder, tags, limit }, ctx = {}) => {
      if (!String(query || '').trim()) return 'Error: say what to look for (query).';
      try {
        const r = await require('../../library/search').search(ctx.user || null, String(query), {
          kinds: Array.isArray(kinds) ? kinds : null, folder: folder || null, tags: Array.isArray(tags) ? tags : null,
          limit: Math.min(30, Math.max(1, Number(limit) || 8)), signal: ctx.signal });
        if (!r.results.length) return r.note || `Nothing in the Library matches "${query}".`;
        return [`${r.results.length} file${r.results.length === 1 ? '' : 's'} of the person's own, best first (score: similarity to the query):`, ...r.results.map(line)].join('\n');
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];

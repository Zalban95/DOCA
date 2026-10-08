'use strict';

/**
 * The Library's labelled set (docs/experiments/library.md), made on the spot so nothing personal is measured: spoken
 * clips through the hub's text-to-speech, pictures drawn as SVG and rasterised by resvg, silent videos made by ffmpeg
 * from two pictures each, and short documents. Every file has a neutral name (item-07.png), so a search can only find
 * it by what is in it; each carries the query that should find it (in other words than its content) and the tags a
 * person would accept for it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIO = [
  ['Remember to water the tomatoes in the greenhouse every evening.', 'a voice note about watering the plants'],
  ['The boiler service is booked for next Tuesday at nine in the morning.', 'when the heating repair is scheduled'],
  ['Our flight to Lisbon leaves from gate twelve at half past six.', 'airport departure information'],
  ['Please pick up milk, eggs and bread on the way home.', 'a shopping list for groceries'],
  ['The password for the guest wifi is printed on the fridge door.', 'where the internet login for visitors is written'],
  ['Happy birthday! I hope you have a wonderful party with all your friends.', 'a birthday greeting'],
  ['The quarterly sales numbers went up by fifteen percent this year.', 'business revenue results'],
  ['The dog has to go to the vet for his vaccinations on Friday.', 'the pet\'s medical appointment'],
].map(([say, query]) => ({ say, query, tags: ['speech', 'conversation'] }));

const W = 512, Hh = 384;
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
const words = (t, y = 200, size = 44) => `<text x="256" y="${y}" font-size="${size}" text-anchor="middle" font-weight="bold" fill="#111">${t}</text>`;
const IMAGES = [
  { draw: svg('<circle cx="256" cy="192" r="120" fill="#d00"/>'), query: 'a red ball', tags: ['drawing'] },
  { draw: svg('<rect width="100%" height="60%" fill="#7cc4ff"/><rect y="60%" width="100%" height="40%" fill="#3a9a3a"/><circle cx="400" cy="80" r="50" fill="#ffd700"/>'), query: 'a sunny day in the countryside', tags: ['sky', 'garden', 'drawing', 'mountains', 'forest'] },
  { draw: svg(`${words('INVOICE', 110, 52)}${words('Coffee beans  12.00', 190, 28)}${words('Delivery  4.50', 235, 28)}${words('TOTAL  16.50 EUR', 300, 34)}`), query: 'a bill to pay', tags: ['receipt', 'document', 'text'] },
  { draw: svg('<rect x="80" y="240" width="60" height="100" fill="#36c"/><rect x="170" y="160" width="60" height="180" fill="#36c"/><rect x="260" y="100" width="60" height="240" fill="#36c"/><rect x="350" y="200" width="60" height="140" fill="#36c"/><line x1="60" y1="340" x2="450" y2="340" stroke="#000" stroke-width="3"/>'), query: 'a graph with bars going up', tags: ['chart', 'drawing'] },
  { draw: svg('<rect x="156" y="180" width="200" height="150" fill="#c96"/><polygon points="136,180 256,80 376,180" fill="#a33"/><rect x="236" y="250" width="40" height="80" fill="#552"/>'), query: 'a drawing of a home', tags: ['house', 'drawing'] },
  { draw: svg('<rect x="236" y="250" width="40" height="110" fill="#6b4226"/><polygon points="256,40 146,260 366,260" fill="#1f8a2f"/>'), query: 'a tree', tags: ['forest', 'garden', 'drawing', 'flower'] },
  { draw: svg(`${words('MEETING', 150, 60)}${words('TOMORROW AT 3 PM', 240, 40)}`), query: 'an appointment reminder note', tags: ['text', 'notes', 'document', 'screenshot'] },
  { draw: svg('<circle cx="256" cy="192" r="140" fill="#ffd21f"/><circle cx="206" cy="150" r="18" fill="#000"/><circle cx="306" cy="150" r="18" fill="#000"/><path d="M176 230 Q256 310 336 230" stroke="#000" stroke-width="12" fill="none"/>'), query: 'a happy smiling face', tags: ['drawing', 'portrait'] },
  { draw: svg(`<polygon points="186,42 326,42 426,142 426,242 326,342 186,342 86,242 86,142" fill="#c00"/>${words('STOP', 215, 80).replace('#111', '#fff')}`), query: 'a traffic sign', tags: ['drawing', 'text', 'city'] },
  { draw: svg('<rect width="100%" height="100%" fill="#0a1030"/><circle cx="360" cy="110" r="60" fill="#f4f1c9"/><circle cx="380" cy="95" r="55" fill="#0a1030"/><circle cx="100" cy="80" r="4" fill="#fff"/><circle cx="180" cy="160" r="3" fill="#fff"/><circle cx="60" cy="250" r="4" fill="#fff"/><circle cx="250" cy="60" r="3" fill="#fff"/>'), query: 'the moon and stars at night', tags: ['night', 'sky', 'drawing'] },
];

const VIDEOS = [
  { frames: [svg('<rect x="100" y="200" width="320" height="80" rx="20" fill="#06c"/><circle cx="170" cy="290" r="35" fill="#222"/><circle cx="350" cy="290" r="35" fill="#222"/><rect x="170" y="150" width="180" height="60" fill="#06c"/>'),
    svg('<rect x="140" y="200" width="320" height="80" rx="20" fill="#06c"/><circle cx="210" cy="290" r="35" fill="#222"/><circle cx="390" cy="290" r="35" fill="#222"/><rect x="210" y="150" width="180" height="60" fill="#06c"/>')], query: 'a car driving', tags: ['car', 'drawing'] },
  { frames: [svg('<rect width="100%" height="100%" fill="#1e6fbf"/><ellipse cx="220" cy="190" rx="90" ry="50" fill="#f80"/><polygon points="310,190 370,140 370,240" fill="#f80"/>'),
    svg('<rect width="100%" height="100%" fill="#1e6fbf"/><ellipse cx="280" cy="200" rx="90" ry="50" fill="#f80"/><polygon points="370,200 430,150 430,250" fill="#f80"/>')], query: 'a fish swimming underwater', tags: ['drawing', 'beach'] },
  { frames: [svg('<rect width="100%" height="100%" fill="#dfefff"/><circle cx="256" cy="270" r="90" fill="#fff" stroke="#999"/><circle cx="256" cy="140" r="60" fill="#fff" stroke="#999"/><polygon points="256,140 300,150 256,160" fill="#f60"/>'),
    svg('<rect width="100%" height="100%" fill="#dfefff"/><circle cx="256" cy="270" r="90" fill="#fff" stroke="#999"/><circle cx="256" cy="140" r="60" fill="#fff" stroke="#999"/><polygon points="256,140 300,150 256,160" fill="#f60"/><circle cx="120" cy="60" r="6" fill="#fff"/><circle cx="400" cy="90" r="6" fill="#fff"/>')], query: 'a snowman in winter', tags: ['snow', 'drawing'] },
  { frames: [svg(`${words('CHAPTER ONE', 170, 54)}${words('The Beginning', 240, 34)}`), svg(`${words('THE END', 200, 70)}`)], query: 'title cards with words', tags: ['text', 'drawing', 'document'] },
];

const DOCS = [
  ['Preheat the oven to 180 degrees. Mix the flour, sugar and butter, add three eggs and bake the cake for forty minutes.', 'how to bake a dessert'],
  ['The lease runs for twelve months; rent is due on the first of each month and the deposit is two months of rent.', 'the apartment rental agreement'],
  ['To reset the router, hold the small button on the back for ten seconds until the lights blink.', 'fixing the internet box'],
  ['Day one: arrive in Kyoto, visit the temples. Day two: train to Osaka, street food in Dotonbori.', 'a travel itinerary in Japan'],
  ['Take one tablet twice a day with food for seven days. Do not drink alcohol while taking this medicine.', 'instructions for a prescription'],
  ['The team agreed to move the release to March and to hire two more engineers for the mobile app.', 'minutes of a work meeting'],
].map(([text, query]) => ({ text, query, tags: ['document', 'notes', 'letter', 'text'] }));

const pad = n => String(n).padStart(2, '0');

/** Make every file under `dir`; returns [{file, kind, query, tags}]. Needs the TTS service and ffmpeg. */
async function make(dir, { ttsUrl, ttsModel, ttsVoice }) {
  const render = require('../../modules/api-v1/render');
  const out = [];
  let n = 0;
  for (const a of AUDIO) {
    const r = await fetch(`${ttsUrl}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ttsModel, input: a.say, voice: ttsVoice, response_format: 'wav' }), signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`TTS ${r.status} from ${ttsUrl}`);
    const file = path.join(dir, `item-${pad(++n)}.wav`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    out.push({ file, kind: 'audio', query: a.query, tags: a.tags });
  }
  for (const im of IMAGES) {
    const file = path.join(dir, `item-${pad(++n)}.png`);
    fs.writeFileSync(file, await render.svgToPng(im.draw, { w: W }));
    out.push({ file, kind: 'images', query: im.query, tags: im.tags });
  }
  for (const v of VIDEOS) {
    const pngs = [];
    for (const f of v.frames) { const p = path.join(dir, `.frame-${pngs.length}.png`); fs.writeFileSync(p, await render.svgToPng(f, { w: W })); pngs.push(p); }
    const file = path.join(dir, `item-${pad(++n)}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '6', '-i', pngs[0], '-loop', '1', '-t', '6', '-i', pngs[1],
      '-filter_complex', '[0][1]concat=n=2:v=1:a=0,format=yuv420p', '-r', '10', file]);
    for (const p of pngs) fs.rmSync(p);
    out.push({ file, kind: 'video', query: v.query, tags: v.tags });
  }
  for (const d of DOCS) {
    const file = path.join(dir, `item-${pad(++n)}.txt`);
    fs.writeFileSync(file, d.text);
    out.push({ file, kind: 'documents', query: d.query, tags: d.tags });
  }
  return out;
}

module.exports = { make, AUDIO, IMAGES, VIDEOS, DOCS };

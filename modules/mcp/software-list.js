'use strict';

/**
 * Software for a job — the list (the owner's answer of 2026-10-13 to R2b: "you can leave anything in the suggestion.
 * Even office or any other open or proprietary software and suggest download or connection if present").
 *
 * Per job, the programs people use for it, open or proprietary, each marked by what it is — never ranked, never one
 * pushed: software.js orders them by what is here first, then by name. A row says:
 *   marks    what it is, in plain words: 'open source', 'free', 'paid', 'popular' (widely used for this job)
 *   site     its maker's own download page (never a mirror)
 *   find     how to see it is here: `bin` names on PATH, folders under /Applications (`mac`) or Program Files (`win`),
 *            matched by the start of their name
 *   mcp      a catalogue row this panel installs and connects (the Craft App Suite, catalog-craft.js)
 *   account  a connector (connectors/catalog.js) through which DOCA reaches it with the person's own account
 * Nothing here is an endorsement or an affiliation; a row is a fact about a program and where its maker offers it.
 */
const JOBS = [
  ['image', 'Edit images'], ['vector', 'Draw vectors'], ['video', 'Edit video'], ['photos', 'Develop and keep photos'],
  ['pdf', 'Work with PDFs'], ['motion', 'Motion graphics and effects'], ['layout', 'Page layout'], ['documents', 'Write documents'],
  ['audio', 'Record and edit audio'], ['slides', 'Make presentations'], ['cad', 'CAD and drafting'], ['sheets', 'Spreadsheets'],
  ['3d', '3D modelling and animation'],
];

const O = (name, jobs, marks, site, find = {}, extra = {}) => ({ name, jobs, marks, site, find, ...extra });
const craft = (id, name, job) => O(name, [job], ['open source', 'free'], `https://github.com/storytold/${id}/releases`, { bin: [`${id}-cli`] }, { mcp: id });
const LO = 'https://www.libreoffice.org/download/download-libreoffice/';
const lo = { bin: ['libreoffice', 'soffice'], mac: ['LibreOffice'], win: ['LibreOffice'] };
const MS = 'https://www.microsoft.com/microsoft-365';
const ms = app => ({ mac: [`Microsoft ${app}`], win: ['Microsoft Office'] });

const OPTIONS = [
  craft('photocraft', 'PhotoCraft', 'image'), craft('vectorcraft', 'VectorCraft', 'vector'), craft('filmcraft', 'FilmCraft', 'video'),
  craft('lightcraft', 'LightCraft', 'photos'), craft('pdfcraft', 'PdfCraft', 'pdf'), craft('effectcraft', 'EffectCraft', 'motion'),
  craft('designcraft', 'DesignCraft', 'layout'), craft('wordcraft', 'WordCraft', 'documents'), craft('soundcraft', 'SoundCraft', 'audio'),
  craft('deckcraft', 'DeckCraft', 'slides'), craft('cadcraft', 'CADCraft', 'cad'), craft('gridcraft', 'GridCraft', 'sheets'),

  O('GIMP', ['image'], ['open source', 'free', 'popular'], 'https://www.gimp.org/downloads/', { bin: ['gimp'], mac: ['GIMP'], win: ['GIMP'] }),
  O('Krita', ['image'], ['open source', 'free'], 'https://krita.org/en/download/', { bin: ['krita'], mac: ['krita'], win: ['Krita'] }),
  O('Adobe Photoshop', ['image'], ['paid', 'popular'], 'https://www.adobe.com/products/photoshop.html', { mac: ['Adobe Photoshop'], win: ['Adobe\\Adobe Photoshop'] }),
  O('Inkscape', ['vector'], ['open source', 'free', 'popular'], 'https://inkscape.org/release/', { bin: ['inkscape'], mac: ['Inkscape'], win: ['Inkscape'] }),
  O('Adobe Illustrator', ['vector'], ['paid', 'popular'], 'https://www.adobe.com/products/illustrator.html', { mac: ['Adobe Illustrator'], win: ['Adobe\\Adobe Illustrator'] }),
  O('Kdenlive', ['video'], ['open source', 'free'], 'https://kdenlive.org/download/', { bin: ['kdenlive'], mac: ['kdenlive'], win: ['kdenlive'] }),
  O('Shotcut', ['video'], ['open source', 'free'], 'https://shotcut.org/download/', { bin: ['shotcut'], mac: ['Shotcut'], win: ['Shotcut'] }),
  O('DaVinci Resolve', ['video'], ['free', 'paid', 'popular'], 'https://www.blackmagicdesign.com/products/davinciresolve', { bin: ['resolve'], mac: ['DaVinci Resolve'], win: ['Blackmagic Design\\DaVinci Resolve'] }),
  O('Adobe Premiere Pro', ['video'], ['paid', 'popular'], 'https://www.adobe.com/products/premiere.html', { mac: ['Adobe Premiere Pro'], win: ['Adobe\\Adobe Premiere Pro'] }),
  O('darktable', ['photos'], ['open source', 'free'], 'https://www.darktable.org/install/', { bin: ['darktable'], mac: ['darktable'], win: ['darktable'] }),
  O('RawTherapee', ['photos'], ['open source', 'free'], 'https://rawtherapee.com/downloads/', { bin: ['rawtherapee'], mac: ['RawTherapee'], win: ['RawTherapee'] }),
  O('Adobe Lightroom', ['photos'], ['paid', 'popular'], 'https://www.adobe.com/products/photoshop-lightroom.html', { mac: ['Adobe Lightroom'], win: ['Adobe\\Adobe Lightroom'] }),
  O('PDF Arranger', ['pdf'], ['open source', 'free'], 'https://github.com/pdfarranger/pdfarranger', { bin: ['pdfarranger'], win: ['PDF Arranger'] }),
  O('Adobe Acrobat', ['pdf'], ['paid', 'popular'], 'https://www.adobe.com/acrobat.html', { mac: ['Adobe Acrobat'], win: ['Adobe\\Acrobat'] }),
  O('Natron', ['motion'], ['open source', 'free'], 'https://natrongithub.github.io/', { bin: ['natron', 'Natron'], mac: ['Natron'], win: ['Natron'] }),
  O('Adobe After Effects', ['motion'], ['paid', 'popular'], 'https://www.adobe.com/products/aftereffects.html', { mac: ['Adobe After Effects'], win: ['Adobe\\Adobe After Effects'] }),
  O('Remotion', ['motion', 'video'], ['free', 'paid'], 'https://www.remotion.dev/'),   // a library, not an app: per project (skills/video-from-code); companies of 4+ pay
  O('Blender', ['motion', '3d'], ['open source', 'free', 'popular'], 'https://www.blender.org/download/', { bin: ['blender'], mac: ['Blender'], win: ['Blender Foundation'] }),
  O('Scribus', ['layout'], ['open source', 'free'], 'https://www.scribus.net/downloads/', { bin: ['scribus'], mac: ['Scribus'], win: ['Scribus'] }),
  O('Adobe InDesign', ['layout'], ['paid', 'popular'], 'https://www.adobe.com/products/indesign.html', { mac: ['Adobe InDesign'], win: ['Adobe\\Adobe InDesign'] }),
  O('LibreOffice', ['documents', 'slides', 'sheets'], ['open source', 'free', 'popular'], LO, lo),
  O('Microsoft Word', ['documents'], ['paid', 'popular'], MS, ms('Word'), { account: 'microsoft' }),
  O('Microsoft PowerPoint', ['slides'], ['paid', 'popular'], MS, ms('PowerPoint'), { account: 'microsoft' }),
  O('Microsoft Excel', ['sheets'], ['paid', 'popular'], MS, ms('Excel'), { account: 'microsoft' }),
  O('Google Docs', ['documents'], ['free', 'popular'], 'https://docs.google.com/', {}, { account: 'google', web: true }),
  O('Google Slides', ['slides'], ['free', 'popular'], 'https://slides.google.com/', {}, { account: 'google', web: true }),
  O('Google Sheets', ['sheets'], ['free', 'popular'], 'https://sheets.google.com/', {}, { account: 'google', web: true }),
  O('Apple Keynote', ['slides'], ['free'], 'https://www.apple.com/keynote/', { mac: ['Keynote'] }, { os: 'darwin' }),
  O('Audacity', ['audio'], ['open source', 'free', 'popular'], 'https://www.audacityteam.org/download/', { bin: ['audacity'], mac: ['Audacity'], win: ['Audacity'] }),
  O('Ardour', ['audio'], ['open source', 'paid'], 'https://ardour.org/download.html', { bin: ['ardour', 'ardour8'], mac: ['Ardour'], win: ['Ardour'] }),
  O('Adobe Audition', ['audio'], ['paid'], 'https://www.adobe.com/products/audition.html', { mac: ['Adobe Audition'], win: ['Adobe\\Adobe Audition'] }),
  O('FreeCAD', ['cad'], ['open source', 'free', 'popular'], 'https://www.freecad.org/downloads.php', { bin: ['freecad', 'FreeCAD'], mac: ['FreeCAD'], win: ['FreeCAD'] }),
  O('LibreCAD', ['cad'], ['open source', 'free'], 'https://librecad.org/', { bin: ['librecad'], mac: ['LibreCAD'], win: ['LibreCAD'] }),
  O('Autodesk AutoCAD', ['cad'], ['paid', 'popular'], 'https://www.autodesk.com/products/autocad/', { mac: ['AutoCAD'], win: ['Autodesk\\AutoCAD'] }),
  O('Autodesk Maya', ['3d'], ['paid', 'popular'], 'https://www.autodesk.com/products/maya/', { mac: ['Autodesk\\maya', 'Maya'], win: ['Autodesk\\Maya'] }),
];

module.exports = { JOBS, OPTIONS };

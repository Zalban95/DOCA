/* 3D files, shown as themselves wherever a file is shown (asked 2026-10-06, for what hi3d.ai and other generators
   make): the chat, the Files tab, the Projects editor and the full-screen viewer all draw a model the same way.
   GLB and GLTF with Google's <model-viewer> (Apache-2.0; orbit, zoom, auto-rotate, lighting); STL, OBJ, FBX, PLY and
   3MF with three.js and its loaders (MIT), framed and lit the same way; USDZ is Apple's and is offered as a download
   (and as AR on an iPhone). Both libraries load from the CDN the first time a model is opened, like the code editor's. */
const MODEL3D_EXTS = ['glb', 'gltf', 'stl', 'obj', 'fbx', 'ply', '3mf', 'usdz'];
const MODEL3D_THREE = 'https://cdn.jsdelivr.net/npm/three@0.170.0';
let _model3dViewer = null;

const model3dExt = name => String(name || '').split('?')[0].split('.').pop().toLowerCase();
const model3dIs = name => MODEL3D_EXTS.includes(model3dExt(name));

function _model3dModelViewer() {
  _model3dViewer ||= new Promise((resolve, reject) => {
    if (customElements.get('model-viewer')) return resolve();
    const s = Object.assign(document.createElement('script'), { type: 'module', src: 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js' });
    s.onload = resolve; s.onerror = () => { _model3dViewer = null; reject(new Error('the 3D viewer could not be loaded (no connection to cdn.jsdelivr.net?)')); };
    document.head.appendChild(s);
  });
  return _model3dViewer;
}

/** Draw the model at `url` into `box` (which sets the size). Returns a function that stops it. */
async function model3dInto(box, url, name) {
  const ext = model3dExt(name || url);
  box.textContent = 'Loading the 3D viewer…';
  box.classList.add('model3d-box');
  if (ext === 'usdz') {
    box.innerHTML = `<div class="model3d-note">${escHtml(name || 'model.usdz')} — a USDZ model (Apple's format): <a href="${escHtml(url)}" download>download</a>
      ${/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? ` · <a rel="ar" href="${escHtml(url)}">view in AR</a>` : ''}</div>`;
    return () => {};
  }
  if (ext === 'glb' || ext === 'gltf') {
    try { await _model3dModelViewer(); } catch (e) { box.textContent = `${name}: ${e.message}`; return () => {}; }
    box.textContent = '';
    const mv = document.createElement('model-viewer');
    Object.assign(mv, { src: url, alt: name || 'a 3D model' });
    for (const a of ['camera-controls', 'auto-rotate', 'touch-action']) mv.setAttribute(a, a === 'touch-action' ? 'pan-y' : '');
    mv.setAttribute('shadow-intensity', '1');
    mv.style.cssText = 'width:100%;height:100%;background:transparent';
    box.appendChild(mv);
    return () => mv.remove();
  }
  return _model3dThree(box, url, name, ext);
}

/** STL, OBJ, FBX, PLY, 3MF: three.js, the model centred and framed, orbiting with the mouse or a finger. */
async function _model3dThree(box, url, name, ext) {
  let THREE, Orbit, Loader;
  try {
    THREE = await import(`${MODEL3D_THREE}/+esm`);
    ({ OrbitControls: Orbit } = await import(`${MODEL3D_THREE}/examples/jsm/controls/OrbitControls.js/+esm`));
    const file = { stl: 'STLLoader', obj: 'OBJLoader', fbx: 'FBXLoader', ply: 'PLYLoader', '3mf': '3MFLoader' }[ext];
    Loader = (await import(`${MODEL3D_THREE}/examples/jsm/loaders/${file}.js/+esm`))[file.replace('3MF', 'ThreeMF')];
  } catch (e) { box.textContent = `${name}: the 3D viewer could not be loaded (no connection to cdn.jsdelivr.net?)`; return () => {}; }
  box.textContent = '';
  const w = () => box.clientWidth || 400, h = () => box.clientHeight || 300;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w(), h());
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, w() / h(), 0.01, 10000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 5, 4); scene.add(sun);
  const controls = new Orbit(camera, renderer.domElement);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  let loaded;
  try { loaded = await new Loader().loadAsync(url); } catch (e) { box.textContent = `${name}: could not read it (${e.message || e})`; renderer.dispose(); return () => {}; }
  const obj = loaded.isBufferGeometry
    ? new THREE.Mesh(loaded, new THREE.MeshStandardMaterial({ color: 0xc8c8d0, metalness: 0.1, roughness: 0.55, vertexColors: !!loaded.attributes.color }))
    : loaded;
  if (loaded.isBufferGeometry) loaded.computeVertexNormals();   // files often carry zero normals (and STL's are per face anyway)
  if (ext === 'stl' || ext === '3mf') obj.rotation.x = -Math.PI / 2;   // printers think Z is up
  scene.add(obj);
  obj.updateMatrixWorld(true);   // the rotation counts in the bounds
  const bounds = new THREE.Box3().setFromObject(obj), size = bounds.getSize(new THREE.Vector3()).length() || 1, centre = bounds.getCenter(new THREE.Vector3());
  obj.position.sub(centre);
  camera.position.set(size * 0.95, size * 0.6, size * 1.25);   // the whole model in view, a little from above
  camera.near = size / 1000; camera.far = size * 100; camera.updateProjectionMatrix();
  controls.update();
  let raf = 0, live = true;
  const tick = () => { if (!live || !box.isConnected) return stop(); controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
  const ro = new ResizeObserver(() => { renderer.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix(); });
  ro.observe(box);
  function stop() { live = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); }
  tick();
  return stop;
}

/** A model full screen, over the page; Back or ✕ closes it. */
function model3dFull(url, name) {
  const ov = Object.assign(document.createElement('div'), { className: 'model3d-full' });
  ov.innerHTML = `<div class="model3d-bar"><b>${escHtml(name || '')}</b><span style="flex:1"></span>
    <a class="btn btn-xs" href="${escHtml(url)}" download="${escHtml(name || '')}">⬇ Download</a><button class="btn btn-xs" type="button">✕</button></div><div class="model3d-stage"></div>`;
  document.body.append(ov);
  let stop = () => {};
  const close = () => { stop(); ov.remove(); };
  const release = typeof overlayBack === 'function' ? overlayBack(close) : () => {};
  ov.querySelector('.model3d-bar button').onclick = () => { release(); close(); };
  model3dInto(ov.querySelector('.model3d-stage'), url, name).then(s => { stop = s; });
}

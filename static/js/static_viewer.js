// Synchronised 2x2 comparison viewer: TLS reference, TEF, VDBFusion, PIN-SLAM.
// One WebGL canvas, four scissored viewports, one shared camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchTEFM, toLinear } from './codec.js';

const BASE = 'static/data/static/';
const PANELS = ['tls', 'T2', 'VF', 'I5'];          // top-left, top-right, bottom-left, bottom-right
const UNSCORED = [0.79, 0.80, 0.82].map(toLinear);
const SHADED = new THREE.Color().setRGB(0.87, 0.86, 0.83, THREE.SRGBColorSpace);
// Error ramp in cm, split at the paper's 10 cm F10 threshold: cool below, warm above.
const RAMP = [[0, [0.93, 0.95, 0.98]], [5, [0.78, 0.86, 0.95]], [10, [0.55, 0.70, 0.88]],
              [10.001, [1.00, 0.86, 0.42]], [20, [0.96, 0.50, 0.20]], [30, [0.70, 0.09, 0.11]]];
export function errorColor(cm) {
  cm = Math.min(30, Math.max(0, cm));
  for (let k = 1; k < RAMP.length; k++) {
    const [c1, v1] = RAMP[k];
    if (cm <= c1) {
      const [c0, v0] = RAMP[k - 1], t = (cm - c0) / (c1 - c0);
      return v0.map((v, j) => v + t * (v1[j] - v));
    }
  }
  return RAMP[RAMP.length - 1][1];
}
export const RAMP_CSS = 'linear-gradient(90deg,' + RAMP.map(([c, v]) =>
  `rgb(${v.map(x => Math.round(x * 255)).join(',')}) ${(c / 30 * 100).toFixed(2)}%`).join(',') + ')';
const ERR_LIN = Array.from({ length: 255 }, (_, i) => errorColor(i / 254 * 30).map(toLinear));

function lightRig(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 1.7);
  hemi.position.set(0, 0, 1);
  const head = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(hemi, head, head.target);
  scene.userData.head = head;
  return scene;
}

function heightRamp(z, lo, hi) {
  const t = Math.min(1, Math.max(0, (z - lo) / (hi - lo)));
  // slate (low) -> pale blue (high), sRGB
  return [0.44 + 0.40 * t, 0.48 + 0.40 * t, 0.55 + 0.39 * t].map(toLinear);
}

function circleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StaticComparison {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#static-canvas');
    this.message = root.querySelector('#static-message');
    this.stats = [...root.querySelectorAll('.panel-stat')];
    this.samples = root.querySelector('#static-samples');
    this.caption = root.querySelector('#static-caption');
    this.colorbar = root.querySelector('#static-colorbar');
    this.modeButtons = [...root.querySelectorAll('[data-mode]')];
    this.mode = 'error';
    this.token = 0;
    this.visible = false;
    this.dirty = true;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setScissorTest(true);
    this.renderer.setClearColor(0xffffff, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.scenes = PANELS.map(() => lightRig(new THREE.Scene()));
    this.materials = {
      error: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      shaded: new THREE.MeshLambertMaterial({ color: SHADED, side: THREE.DoubleSide }),
      points: new THREE.PointsMaterial({ size: 0.11, vertexColors: true, sizeAttenuation: true,
                                         map: circleTexture(), alphaTest: 0.5 }),
    };
    this.canvas.addEventListener('dblclick', () => this.resetView());
    new ResizeObserver(() => { this.dirty = true; }).observe(this.canvas);
    this.modeButtons.forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    this.colorbar.querySelector('.ramp').style.background = RAMP_CSS;
    this.loop = this.loop.bind(this);
  }

  async init() {
    this.index = await (await fetch(BASE + 'index.json')).json();
    this.samples.innerHTML = '';
    this.index.crops.forEach((c, i) => {
      const img = document.createElement('img');
      img.className = 'sample-img';
      img.src = BASE + c.thumb;
      img.alt = c.title;
      img.title = c.title;
      img.tabIndex = 0;
      img.addEventListener('click', () => this.select(i));
      img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(i); } });
      this.samples.appendChild(img);
    });
    await this.select(0);
  }

  setVisible(v) {
    this.visible = v;
    this.dirty = true;
    if (v && !this.running) { this.running = true; requestAnimationFrame(this.loop); }
  }

  showMessage(text) {
    this.message.textContent = text || '';
    this.message.classList.toggle('hidden', !text);
  }

  async select(i) {
    const token = ++this.token;
    const crop = this.index.crops[i];
    [...this.samples.children].forEach((el, k) => el.classList.toggle('selected', k === i));
    this.caption.innerHTML = `<b>${crop.title}</b> <span class="sub">· ${crop.subtitle}</span>`;
    this.showMessage('Loading example…');
    const dir = BASE + crop.id + '/';
    const meta = await (await fetch(dir + 'meta.json')).json();
    const files = [meta.tls.file, ...meta.methods.map(m => m.file)];
    const progress = new Array(files.length).fill(0);
    const report = () => {
      if (token === this.token) this.showMessage(`Loading example… ${Math.round(100 * progress.reduce((a, b) => a + b) / files.length)}%`);
    };
    const data = await Promise.all(files.map((f, k) => fetchTEFM(dir + f, p => { progress[k] = p; report(); })));
    if (token !== this.token) return;
    this.clear();
    this.meta = meta;
    const byKey = { tls: data[0] };
    meta.methods.forEach((m, k) => { byKey[m.key] = data[k + 1]; });
    PANELS.forEach((key, k) => {
      const obj = key === 'tls' ? this.buildPoints(byKey.tls) : this.buildMesh(byKey[key]);
      this.scenes[k].add(obj);
      this.scenes[k].userData.object = obj;
    });
    this.stats[0].textContent = `${(meta.tls.points / 1000).toFixed(0)}k points · ${meta.block_m} m crop`;
    PANELS.slice(1).forEach((key, k) => {
      const m = meta.methods.find(x => x.key === key).metrics;
      this.stats[k + 1].innerHTML = `crop F10 <b>${m.f10.toFixed(1)}</b><span class="extra"> · acc ${m.accuracy_cm.toFixed(1)} cm · comp ${m.completeness_cm.toFixed(1)} cm</span>`;
    });
    this.resetView();
    this.setMode(this.mode);
    this.showMessage('');
  }

  clear() {
    this.scenes.forEach(s => {
      const o = s.userData.object;
      if (o) { s.remove(o); o.geometry.dispose(); }
      s.userData.object = null;
    });
  }

  buildMesh(d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeVertexNormals();
    const col = new Float32Array(d.nv * 3);
    for (let i = 0; i < d.nv; i++) col.set(d.scalar[i] === 255 ? UNSCORED : ERR_LIN[d.scalar[i]], 3 * i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Mesh(g, this.mode === 'error' ? this.materials.error : this.materials.shaded);
  }

  buildPoints(d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    const z = [];
    for (let i = 2; i < d.positions.length; i += 3 * 17) z.push(d.positions[i]);
    z.sort((a, b) => a - b);
    const lo = z[Math.floor(z.length * 0.02)], hi = z[Math.floor(z.length * 0.98)];
    const col = new Float32Array(d.nv * 3);
    for (let i = 0; i < d.nv; i++) col.set(heightRamp(d.positions[3 * i + 2], lo, hi), 3 * i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, this.materials.points);
  }

  setMode(mode) {
    this.mode = mode;
    this.modeButtons.forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
    this.colorbar.classList.toggle('hidden', mode !== 'error');
    this.scenes.slice(1).forEach(s => {
      if (s.userData.object) s.userData.object.material = mode === 'error' ? this.materials.error : this.materials.shaded;
    });
    this.dirty = true;
  }

  resetView() {
    if (!this.meta) return;
    this.camera.position.fromArray(this.meta.camera.position);
    this.controls.target.fromArray(this.meta.camera.target);
    this.controls.update();
    this.dirty = true;
  }

  loop() {
    if (!this.visible) { this.running = false; return; }
    requestAnimationFrame(this.loop);
    const moved = this.controls.update();
    if (!moved && !this.dirty) return;
    this.dirty = false;
    const r = this.renderer, c = this.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const size = r.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.setSize(w, h, false);
    const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
    this.camera.aspect = hw / hh;
    // keep the horizontal field of view of a landscape panel when panels become tall (phones)
    const minAspect = 1.4;
    this.camera.fov = this.camera.aspect >= minAspect ? 45
      : 2 * Math.atan(Math.tan(Math.PI / 8) * minAspect / this.camera.aspect) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
    r.setScissor(0, 0, w, h);
    r.setViewport(0, 0, w, h);
    r.clear();
    this.scenes.forEach((s, k) => {
      const x = (k % 2) * (w - hw), y = k < 2 ? h - hh : 0;
      r.setViewport(x, y, hw, hh);
      r.setScissor(x, y, hw, hh);
      const head = s.userData.head;
      head.position.copy(this.camera.position);
      head.target.position.copy(this.controls.target);
      r.render(s, this.camera);
    });
  }
}

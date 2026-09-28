// 4D viewer: several KITTI sequences, each with the camera-coloured TEF map (revealed causally), every
// tracked object's mesh revisions at its estimated poses (LiDAR + image runs), trajectories, the camera
// frame, and a chart (pose error when an audit exists, otherwise per-object update status).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { fetchTEFM, SRGB_TO_LINEAR } from './codec.js';

const BASE = 'static/data/dynamic/';
const FPS = 10;                                    // KITTI LiDAR rate: real-time playback
const C = { predicted: '#f29900', heldout: '#5f6368', ego: '#80868b' };
const STATUS_TEXT = {
  lidar: 'LiDAR registration accepted',
  lidar_image: 'LiDAR registration + image refinement accepted',
  image_only: 'image refinement only (LiDAR rejected)',
  prediction: 'no accepted update: motion prediction',
  heldout_prediction: 'held-out frame: prediction only',
};
const hexLin = h => new THREE.Color(h).toArray();

function circleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); g.beginPath(); g.arc(16, 16, 13, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function smoothPath(P, w) {
  return P.map((_, i) => {
    let s = [0, 0, 0], n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(P.length - 1, i + w); k++) { s = s.map((v, j) => v + P[k][j]); n++; }
    return s.map(v => v / n);
  });
}

export class DynamicViewer {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#dyn-canvas');
    this.message = root.querySelector('#dyn-message');
    this.frameImg = root.querySelector('#dyn-frame');
    this.status = root.querySelector('#dyn-status');
    this.slider = root.querySelector('#dyn-slider');
    this.playBtn = root.querySelector('#dyn-play');
    this.timeLabel = root.querySelector('#dyn-time');
    this.chart = root.querySelector('#dyn-chart');
    this.chartTitle = root.querySelector('#dyn-chart-title');
    this.samples = root.querySelector('#dyn-samples');
    this.caption = root.querySelector('#dyn-caption');
    this.follow = root.querySelector('#dyn-follow');
    this.bgToggle = root.querySelector('#dyn-bg');
    this.index = 0; this.playing = true; this.visible = false; this.dirty = true; this.lastTick = 0; this.token = 0;
    this.cache = {};

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xf6f7f8, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 1.9); hemi.position.set(0, 0, 1);
    this.head = new THREE.DirectionalLight(0xffffff, 1.2);
    this.scene.add(hemi, this.head, this.head.target);
    this.bgMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.dotTex = circleTexture();
    this.lineMats = [];
    this.objs = [];
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.loop = this.loop.bind(this);
    new ResizeObserver(() => { this.dirty = true; this.drawChart(); }).observe(this.canvas);
    this.bindUI();
  }

  async init() {
    this.list = (await (await fetch(BASE + 'index.json')).json()).sequences;
    this.samples.innerHTML = '';
    this.list.forEach((s, i) => {
      const img = document.createElement('img');
      img.className = 'sample-img'; img.src = BASE + s.thumb; img.alt = s.title; img.title = s.title; img.tabIndex = 0;
      img.addEventListener('click', () => this.selectSequence(i));
      img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.selectSequence(i); } });
      this.samples.appendChild(img);
    });
    await this.selectSequence(0);
  }

  showMessage(text) { this.message.textContent = text || ''; this.message.classList.toggle('hidden', !text); }

  bindUI() {
    this.playBtn.addEventListener('click', () => this.setPlaying(!this.playing));
    this.slider.addEventListener('input', () => { this.setPlaying(false); this.setFrame(Number(this.slider.value)); });
    this.bgToggle.addEventListener('change', () => { if (this.bg) this.bg.visible = this.bgToggle.checked; this.dirty = true; });
    this.follow.addEventListener('change', () => { if (this.meta) this.setFrame(this.index); });
    this.canvas.addEventListener('dblclick', () => this.resetView());
    const seek = e => {
      if (!this.meta) return;
      const box = this.chart.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width * this.chartW;
      const i = Math.round((x - this.chartX0) / this.chartDx);
      if (i >= 0 && i < this.meta.frames.length) { this.setPlaying(false); this.setFrame(i); }
    };
    this.chart.addEventListener('pointerdown', e => { this.chart.setPointerCapture(e.pointerId); seek(e); });
    this.chart.addEventListener('pointermove', e => { if (e.buttons) seek(e); });
  }

  setPlaying(p) {
    this.playing = p; this.playBtn.textContent = p ? '❚❚' : '▶'; this.playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  }

  frameUrl(f) { return `${BASE}${this.meta.id}/` + this.meta.image.pattern.replace('{frame:04d}', String(f).padStart(4, '0')); }

  async load(id) {
    if (this.cache[id]) return this.cache[id];
    const dir = BASE + id + '/';
    const meta = await (await fetch(dir + 'meta.json')).json();
    const files = [meta.background.file, ...meta.objects.flatMap(o => o.revisions.map(r => r.file))];
    let done = 0;
    const data = await Promise.all(files.map(f => fetchTEFM(dir + f).then(d => {
      done++; this.showMessage(`Loading example… ${Math.round(100 * done / files.length)}%`); return d;
    })));
    const bg = data[0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(bg.positions, 3));
    g.setIndex(new THREE.BufferAttribute(bg.index, 1));
    const col = new Float32Array(bg.nv * 3); for (let i = 0; i < bg.nv * 3; i++) col[i] = SRGB_TO_LINEAR[bg.rgb[i]];
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    let k = 1;
    const objGeoms = meta.objects.map(o => o.revisions.map(() => {
      const d = data[k++]; const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(d.positions, 3)); og.setIndex(new THREE.BufferAttribute(d.index, 1));
      og.computeVertexNormals(); return og;
    }));
    meta.objects.forEach(o => { o.byFrame = new Map(o.rows.map((r, i) => [r.frame, i])); });
    return (this.cache[id] = { meta, bgGeom: g, objGeoms });
  }

  async selectSequence(i) {
    const token = ++this.token;
    [...this.samples.children].forEach((el, k) => el.classList.toggle('selected', k === i));
    this.showMessage('Loading example…');
    const L = await this.load(this.list[i].id);
    if (token !== this.token) return;
    this.clearScene();
    this.meta = L.meta;
    const M = this.meta;
    this.bg = new THREE.Mesh(L.bgGeom, this.bgMaterial); this.bg.visible = this.bgToggle.checked; this.group.add(this.bg);
    this.objs = M.objects.map((o, k) => {
      const mesh = new THREE.Mesh(L.objGeoms[k][0], new THREE.MeshLambertMaterial({ color: o.colour, side: THREE.DoubleSide }));
      mesh.matrixAutoUpdate = false; this.group.add(mesh);
      const pos = [];
      for (let j = 1; j < o.rows.length; j++) {
        const a = o.rows[j - 1].pose, b = o.rows[j].pose;
        pos.push(a[0][3], a[1][3], a[2][3] + 0.05, b[0][3], b[1][3], b[2][3] + 0.05);
      }
      const line = new LineSegments2(new LineSegmentsGeometry().setPositions(pos.length ? pos : [0, 0, 0, 0, 0, 0]),
                                     new LineMaterial({ color: o.colour, linewidth: 4 }));
      this.lineMats.push(line.material); this.group.add(line);
      const dp = new Float32Array(o.rows.length * 3), dc = new Float32Array(o.rows.length * 3);
      o.rows.forEach((r, j) => {
        dp.set([r.pose[0][3], r.pose[1][3], r.pose[2][3] + 0.05], 3 * j);
        dc.set(hexLin(r.heldout ? C.heldout : r.accepted ? o.colour : C.predicted), 3 * j);
      });
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('color', new THREE.BufferAttribute(dc, 3));
      const dots = new THREE.Points(dg, new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true,
                                                                   map: this.dotTex, alphaTest: 0.5, depthTest: false }));
      dots.renderOrder = 2; this.group.add(dots);
      return { o, mesh, line, dots, geoms: L.objGeoms[k] };
    });
    const pos = []; const P = M.ego_path;
    for (let j = 1; j < P.length; j++) pos.push(...P[j - 1], ...P[j]);
    const ego = new LineSegments2(new LineSegmentsGeometry().setPositions(pos),
                                  new LineMaterial({ color: C.ego, linewidth: 2.5, dashed: true, dashSize: 0.8, gapSize: 0.5 }));
    ego.computeLineDistances(); this.lineMats.push(ego.material); this.group.add(ego);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.egoDot = new THREE.Points(eg, new THREE.PointsMaterial({ size: 12, sizeAttenuation: false, color: C.ego, map: this.dotTex, alphaTest: 0.5 }));
    this.group.add(this.egoDot);
    const S = smoothPath(P, 6);
    this.heading = S.map((p, j) => {
      const q = S[Math.min(S.length - 1, j + 3)], r = S[Math.max(0, j - 3)];
      const v = new THREE.Vector3(q[0] - r[0], q[1] - r[1], 0); return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(1, 0, 0);
    });
    this.smoothEgo = S.map(p => new THREE.Vector3(...p));
    this.slider.max = String(M.frames.length - 1);
    this.caption.innerHTML = this.captionHTML();
    this.images = M.frames.map(f => this.frameUrl(f));
    this.index = 0; this.lastFollow = null;
    this.resetView(); this.drawChart(); this.setFrame(0); this.setPlaying(true);
    this.showMessage('');
  }

  captionHTML() {
    const M = this.meta, n = M.objects.length;
    const chips = M.objects.map(o => `<span class="obj-chip"><i style="background:${o.colour}"></i>${o.id}: ${o.summary.image_accepted}/${o.summary.frames}</span>`).join(' ');
    return `<b>${M.title}</b> <span class="sub">· ${n} tracked object${n > 1 ? 's' : ''}, frames ${M.frames[0]}–${M.frames[M.frames.length - 1]}. ${M.note}</span>` +
      `<br><span class="sub">Frames with an accepted image refinement, per object:</span> ${chips}`;
  }

  clearScene() {
    this.group.children.slice().forEach(c => {
      this.group.remove(c);
      if (c.isLineSegments2 || c.isPoints) { c.geometry.dispose(); c.material.dispose(); }
      else if (c.isMesh && c.material !== this.bgMaterial) c.material.dispose();
    });
    this.lineMats = []; this.bg = null; this.objs = [];
  }

  setFrame(i) {
    const M = this.meta; if (!M) return;
    this.index = i; this.slider.value = String(i);
    const f = M.frames[i];
    let faces = 0; for (const s of M.background.reveal) if (s.frame <= f) faces = s.faces;
    this.bg.geometry.setDrawRange(0, faces * 3);
    let inView = 0, nLidar = 0, nImage = 0, nPred = 0, single = null;
    for (const s of this.objs) {
      const rows = s.o.rows, first = rows[0].frame, last = rows[rows.length - 1].frame;
      let upto = -1;
      for (let j = 0; j < rows.length && rows[j].frame <= f; j++) upto = j;
      s.line.geometry.instanceCount = Math.max(upto, 0);
      s.dots.geometry.setDrawRange(0, upto + 1);
      const j = s.o.byFrame.get(f);
      if (j !== undefined && f >= first && f <= last) {
        const r = rows[j];
        s.mesh.visible = true; s.mesh.geometry = s.geoms[r.revision];
        s.mesh.matrix.set(...r.pose.flat()); s.mesh.matrixWorldNeedsUpdate = true;
        inView++; if (r.status === 'lidar' || r.status === 'lidar_image') nLidar++; if (r.image) nImage++; if (!r.accepted) nPred++;
        single = { s, r };
      } else s.mesh.visible = false;
    }
    this.egoDot.geometry.attributes.position.array.set(M.ego_path[i]);
    this.egoDot.geometry.attributes.position.needsUpdate = true; this.egoDot.geometry.computeBoundingSphere();
    this.frameImg.src = this.images[i];
    this.timeLabel.textContent = `frame ${f} · ${M.t[i].toFixed(1)} s`;
    if (M.objects.length === 1 && single) {
      const r = single.r, err = M.audit ? M.audit.center_cm[r.frame] : null;
      const cls = r.heldout ? 'no' : r.accepted ? 'ok' : 'warn';
      this.status.innerHTML = `<b>${M.title}</b><br><span class="${cls}">${STATUS_TEXT[r.status] || r.status}</span>` +
        `<span class="more"><br>shape fused: ${r.fused ? '<span class="ok">yes</span>' : '<span class="no">no</span>'} · mesh from frame ${single.s.o.revisions[r.revision].available_frame}</span>` +
        (err != null ? `<br>center error ${err.toFixed(1)} cm` : '');
    } else {
      this.status.innerHTML = `<b>${M.title}</b><br>${inView} tracked object${inView === 1 ? '' : 's'} at this frame` +
        `<span class="more"><br><span class="ok">${nLidar} LiDAR accepted</span> · ${nImage} with image refinement · <span class="warn">${nPred} predicted</span></span>`;
    }
    if (this.follow.checked) {
      const target = this.smoothEgo[i].clone().addScaledVector(this.heading[i], 10);
      if (this.lastFollow) { const d = target.clone().sub(this.lastFollow); this.camera.position.add(d); this.controls.target.add(d); }
      this.lastFollow = target;
    }
    this.updateCursor(); this.dirty = true;
  }

  resetView() {
    const i = this.index, h = this.heading[i], target = this.smoothEgo[i].clone().addScaledVector(h, 10);
    const back = h.clone().multiplyScalar(-15), side = new THREE.Vector3(-h.y, h.x, 0).multiplyScalar(5);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(back).add(side).add(new THREE.Vector3(0, 0, 11));
    this.lastFollow = target.clone(); this.controls.update(); this.dirty = true;
  }

  setVisible(v) {
    this.visible = v; this.dirty = true;
    if (v && !this.running) { this.running = true; requestAnimationFrame(this.loop); }
  }

  loop(t) {
    if (!this.visible) { this.running = false; return; }
    requestAnimationFrame(this.loop);
    if (this.meta && this.playing && t - this.lastTick >= 1000 / FPS) {
      this.lastTick = t; this.setFrame((this.index + 1) % this.meta.frames.length);
    }
    const moved = this.controls.update();
    if (!moved && !this.dirty) return;
    this.dirty = false;
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2()); if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect >= 1.4 ? 45 : 2 * Math.atan(Math.tan(Math.PI / 8) * 1.4 / this.camera.aspect) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
    this.lineMats.forEach(m => m.resolution.set(w, h));
    this.head.position.copy(this.camera.position); this.head.target.position.copy(this.controls.target);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------- chart: audit error (when available) or per-object update status ----------------
  drawChart() {
    const M = this.meta; if (!M) return;
    const svg = this.chart, W = Math.max(320, Math.round(svg.clientWidth || 880));
    const n = M.frames.length, x0 = 58, x1 = W - 12;
    const dx = (x1 - x0) / Math.max(n - 1, 1); this.chartW = W; this.chartX0 = x0; this.chartDx = dx;
    const X = i => x0 + i * dx; this.chartX = X;
    let s = '', H;
    if (M.audit) {
      H = 150; const y0 = 12, y1 = H - 26, ymax = 25, Y = v => y1 - Math.min(v, ymax) / ymax * (y1 - y0);
      M.objects[0].rows.forEach(r => {
        if (!r.heldout) return; const i = M.frames.indexOf(r.frame);
        s += `<rect x="${X(i) - dx / 2}" y="${y0}" width="${dx}" height="${y1 - y0}" fill="#eceff1"/>`;
      });
      for (let v = 0; v <= ymax; v += 5) {
        s += `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v ? '#f1f3f4' : '#bdc1c6'}"/>`;
        s += `<text x="${x0 - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#80868b">${v}</text>`;
      }
      s += `<text x="14" y="${(y0 + y1) / 2}" font-size="11" fill="#80868b" transform="rotate(-90 14 ${(y0 + y1) / 2})" text-anchor="middle">cm</text>`;
      const pts = M.frames.map((f, i) => M.audit.center_cm[f] != null ? `${X(i).toFixed(1)},${Y(M.audit.center_cm[f]).toFixed(1)}` : null)
        .filter(Boolean).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>`;
      this.chartTitle.innerHTML = `Center error per timestamp <span>— median ${M.audit.median_cm.toFixed(2)} cm, P90 ${M.audit.p90_cm.toFixed(2)} cm (separate post-run audit); shaded: held-out frames</span>`;
      this.cursorY = [y0, y1];
    } else {
      const rowH = 14, top = 8; H = top + rowH * M.objects.length + 28;
      M.objects.forEach((o, k) => {
        const y = top + k * rowH;
        s += `<text x="${x0 - 8}" y="${y + 10}" text-anchor="end" font-size="11" fill="${o.colour}">${o.id}</text>`;
        s += `<line x1="${x0}" x2="${x1}" y1="${y + 6}" y2="${y + 6}" stroke="#f1f3f4"/>`;
        o.rows.forEach(r => {
          const i = M.frames.indexOf(r.frame); if (i < 0) return;
          const fill = r.heldout ? '#dadce0' : !r.accepted ? C.predicted : o.colour;
          const op = r.image || r.heldout || !r.accepted ? 1 : 0.5;
          s += `<rect x="${(X(i) - dx / 2).toFixed(1)}" y="${y + 1}" width="${Math.max(dx - 0.6, 1).toFixed(1)}" height="${rowH - 3}" fill="${fill}" opacity="${op}"/>`;
        });
      });
      this.chartTitle.innerHTML = 'Update per object and frame <span>— solid: LiDAR + image accepted, light: LiDAR accepted, orange: prediction, grey: held-out</span>';
      this.cursorY = [2, top + rowH * M.objects.length];
    }
    for (let i = 0; i < n; i += 20) s += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#80868b">${M.frames[i]}</text>`;
    s += `<line id="dyn-cursor" y1="${this.cursorY[0]}" y2="${this.cursorY[1]}" stroke="#202124" stroke-width="1"/>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.height = `${H}px`; svg.innerHTML = s;
    this.updateCursor();
  }

  updateCursor() {
    const line = this.chart.querySelector('#dyn-cursor'); if (!line || !this.chartX) return;
    const x = this.chartX(this.index); line.setAttribute('x1', x); line.setAttribute('x2', x);
  }
}

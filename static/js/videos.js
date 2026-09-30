// Result-video gallery: one player, category buttons and poster thumbnails (D4RT-style sample selector).
// Videos are offline renders of saved results (tools/render_videos.py).
const BASE = 'static/videos/';
const VIDEOS = [
  { id: 'static_keble', cat: 'static', short: 'Keble College',
    caption: '<b>Oxford Spires · Keble College.</b> The TEF surface of the Table&nbsp;1 segment (540 scans, 12&nbsp;000 returns each). Colours come from the TLS reference survey and are for display only; the dark line is the sensor path from the given poses.' },
  { id: 'static_observatory', cat: 'static', short: 'Observatory Quarter',
    caption: '<b>Oxford Spires · Observatory Quarter.</b> The Observatory segment (the paper\'s supplementary test): courtyard, fountain and the surrounding buildings. Colours are projected from the cameras of the sensor rig for display only; grey surfaces were not seen by a camera.' },
  { id: 'compare_observatory', cat: 'compare', short: 'Observatory 2×2',
    caption: '<b>Four methods, one camera.</b> A 30&nbsp;m Observatory crop: TLS reference, TEF, VDBFusion and PIN-SLAM, all from the same 12&nbsp;000 returns per frame and the same poses, coloured by mesh-to-TLS distance (cool below the 10&nbsp;cm F10 threshold, warm above). Crop F10 is recomputed inside the crop, not the segment score.' },
  { id: 'compare_ncd_west', cat: 'compare', short: 'Newer College 2×2',
    caption: '<b>Four methods, one camera.</b> A 30&nbsp;m crop of the Newer College quad (segment 2700–3299), same protocol and colours.' },
  { id: 'ghost_kitti0005', cat: 'compare', short: 'Ghosts: P2 vs TEF',
    caption: '<b>Where moving road users leave surface (KITTI 0005).</b> One viewpoint on the S-bend: pure fusion of the same implementation (left) and TEF (right). Coloured: surface within 0.3&nbsp;m of input returns from moving road users, by their scan time. The rule selects those returns relative to the TEF surface, so TEF has no coloured vertices by construction; the video shows where pure fusion keeps surface, not a score (controlled numbers: paper Sec.&nbsp;6.4).' },
  { id: 'dyn_kitti0059', cat: 'dynamic', short: 'KITTI 0059 · one car',
    caption: '<b>KITTI 0059, an exploratory object-centric case study.</b> TEF map with camera colours, and the object-local car mesh (revised every 5 frames) placed at the LiDAR + image poses; pink: sensor path and camera frustum. The case study measures object pose, not object-shape accuracy. Poses are interpolated between the 10&nbsp;Hz estimates for display; 0.5× speed.' },
  { id: 'dyn_kitti0005_guard25', cat: 'dynamic', short: 'KITTI 0005 · van + cyclist',
    caption: '<b>KITTI 0005, a van and a cyclist through an S-bend.</b> Updated LiDAR + image replay with the optional 25° vehicle heading guard; the cyclist is excluded. The guard prevents the observed van flip (maximum yaw error 18.2°, versus 177.2° without it, in a post-hoc diagnostic on this clip). Image refinement is accepted on 39 van frames. Matching mesh revisions are shown as they become available; poses interpolated for display; 0.5× speed. See the interactive replay for accepted versus predicted updates.' },
  { id: 'dyn_kitti0014_guard25', cat: 'dynamic', short: 'KITTI 0014 · nine vehicles',
    caption: '<b>KITTI 0014, nine vehicles in one pass</b> (one lead car, eight oncoming). Updated replay with the optional 25° vehicle heading guard. Only target 551\'s last frame changes to a constrained prediction without shape fusion; no ground truth is available at that frame to confirm the correction. Other tracks are unchanged. One colour per vehicle; matching mesh revisions and interpolated poses; 0.5× speed.' },
];

export class VideoGallery {
  constructor(root) {
    this.root = root;
    this.video = root.querySelector('#result-video');
    this.thumbs = root.querySelector('#video-thumbs');
    this.caption = root.querySelector('#video-caption');
    this.cats = [...root.querySelectorAll('[data-cat]')];
    this.visible = false;
    this.current = null;
    this.cats.forEach(b => b.addEventListener('click', () => this.showCategory(b.dataset.cat, true)));
    this.showCategory('static', false);
  }

  showCategory(cat, autoplay) {
    this.cats.forEach(b => b.classList.toggle('selected', b.dataset.cat === cat));
    this.thumbs.innerHTML = '';
    const items = VIDEOS.filter(v => v.cat === cat);
    items.forEach(v => {
      const b = document.createElement('button');
      b.className = 'video-thumb';
      b.style.backgroundImage = `url(${BASE}${v.id}.jpg)`;
      b.setAttribute('aria-label', v.short);
      b.innerHTML = `<span>${v.short}</span>`;
      b.addEventListener('click', () => this.select(v, true));
      this.thumbs.appendChild(b);
    });
    this.select(items[0], autoplay);
  }

  select(v, autoplay) {
    this.current = v;
    [...this.thumbs.children].forEach(b => b.classList.toggle('selected', b.getAttribute('aria-label') === v.short));
    this.caption.innerHTML = v.caption;
    this.video.poster = `${BASE}${v.id}.jpg`;
    this.loaded = false;
    if (this.visible || autoplay) this.load();
  }

  load() {
    if (!this.current || this.loaded) return;
    this.loaded = true;
    this.video.src = `${BASE}${this.current.id}.mp4`;
    this.video.play().catch(() => { /* autoplay may be blocked; controls remain available */ });
  }

  setVisible(on) {
    this.visible = on;
    if (on) { this.load(); if (this.loaded && this.video.paused) this.video.play().catch(() => {}); }
    else if (!this.video.paused) this.video.pause();
  }
}

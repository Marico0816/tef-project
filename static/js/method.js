// Stage details for the pipeline diagram: the algorithm in words, following the manuscript's method section.
const STAGES = {
  inputs: {
    title: '① LiDAR + camera inputs',
    text: [
      'Each LiDAR scan is deskewed with the externally supplied trajectory, limited to 0.5–50 m and capped at 12&nbsp;000 returns per frame.',
      'Sensor poses are given and never optimised.',
      'The static mapper uses LiDAR only; calibrated camera images are used by the vehicle branch (pose refinement) and for display colours.',
    ],
  },
  ellipsoid: {
    title: '② Local surface ellipsoid',
    text: [
      'Point statistics are kept in voxels of three sizes (0.25, 0.5 and 1&nbsp;m) and updated with every new scan before its returns are processed.',
      'For each return, the finest voxel that holds enough points lying close to a plane describes the local surface as a flat ellipsoid.',
      'Its thin axis gives the surface normal and a thickness (at least 2&nbsp;cm); its two long axes give how far the surface extends; the number of points gives a confidence.',
    ],
  },
  samples: {
    title: '③ Weighted samples along the ray',
    text: [
      'Samples are placed just in front of and just behind each return along its ray. Each records its distance to the surface, measured along the normal and scaled by the local thickness: positive on the free side, negative behind.',
      'Each sample gets a weight that drops away from the surface and for less confident neighbourhoods.',
      'The samples closest to the surface are also copied sideways within the local surface, which fills the gaps between neighbouring laser rings.',
    ],
  },
  splat: {
    title: '④ Passing samples to the grid vertices',
    text: [
      'Each sample is shared among the eight corners of its cell in a sparse 4&nbsp;cm GPU grid, with more weight for the nearer corners.',
      'Observations are grouped into one-second blocks, and every grid vertex keeps a weighted average for each block.',
    ],
  },
  evidence: {
    title: '⑤ Temporal-block evidence (TEF core)',
    text: [
      'The blocks are combined with a capped weight, so a second that happens to contain many samples cannot outvote the others by sample count alone.',
      'Separately, each vertex counts how many blocks saw a surface there and how many blocks had measured rays pass through it — at most once per block. A missing observation does not count as a pass.',
      'Where rays keep passing through space that the fused result still treats as solid, the vertex is pushed back towards free space; a local smoothing step keeps the neighbourhood consistent.',
    ],
  },
  mesh: {
    title: '⑥ Mesh extraction',
    text: [
      'The surface is extracted from the revised grid with Surface Nets.',
      'A face is kept only where the grid has enough weight, enough observed corners and a reliable surface crossing.',
      'For the static comparison table, scans are fused in time order on the GPU and the mesh is extracted after the final block. The development ablation used extraction every 10 seconds; dynamic examples replay saved mesh revisions.',
    ],
  },
  objects: {
    title: 'Vehicle branch (exploratory extension)',
    text: [
      'A confirmed vehicle keeps its identity — and keeps receiving its points — when it stops.',
      'Its position and heading are estimated by aligning its current points to its own mesh. An optional image step refines the pose with tracked features on the vehicle and is accepted only after image and geometry checks.',
      'The vehicle\'s shape is fused in its own frame only after an accepted LiDAR alignment, and at every timestamp the vehicle meshes are placed into the background map.',
    ],
  },
};

export function initMethod(root) {
  const detail = root.querySelector('#stage-detail');
  const stages = [...root.querySelectorAll('.stage')];
  const show = key => {
    const s = STAGES[key];
    stages.forEach(g => g.classList.toggle('active', g.dataset.stage === key));
    detail.innerHTML = `<h3>${s.title}</h3>` + s.text.map(t => `<p>${t}</p>`).join('');
  };
  stages.forEach(g => {
    g.addEventListener('click', () => show(g.dataset.stage));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(g.dataset.stage); } });
  });
  show('evidence');
}

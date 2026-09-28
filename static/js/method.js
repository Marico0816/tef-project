// Stage details for the pipeline diagram. Text and equations follow the manuscript's method section.
const STAGES = {
  inputs: {
    title: '① LiDAR + camera inputs',
    text: 'Each scan P<sub>t</sub> is deskewed with the externally supplied trajectory in 2&nbsp;ms bins, filtered to 0.5–50&nbsp;m and deterministically limited to 12&nbsp;000 returns per frame. Sensor poses are fixed; TEF never optimises them. The static mapper is LiDAR-only: calibrated camera images are used by the object branch (pose refinement) and for display colours.',
    eq: ['P_t,\\qquad T_{WL}(t)\\ \\text{(given)},\\qquad I_t\\ \\text{(object branch only)}'],
  },
  ellipsoid: {
    title: '② Local ellipsoid: normal n̂ and thickness τ',
    text: 'Three voxel scales (0.25, 0.5 and 1.0&nbsp;m) keep running statistics (n, Σp, Σpp<sup>T</sup>); the current scan updates them before its returns query them. Each return takes the finest scale with n&nbsp;≥&nbsp;30 and √(λ<sub>0</sub>/λ<sub>2</sub>)&nbsp;≤&nbsp;0.15. The smallest-eigenvalue direction gives the sensor-facing normal, the other two span the tangent plane. This is a dispersion test, not a guarantee of a single plane.',
    eq: ['\\hat{\\mathbf n}=\\mathbf e_0,\\qquad \\tau=\\max\\!\\big(\\sqrt{\\lambda_0},\\,0.02\\,\\mathrm m\\big),\\qquad \\sigma_{1,2}=\\max\\!\\big(\\sqrt{\\lambda_{1,2}},\\,v/4\\big),\\qquad c=\\frac{n}{n+30}'],
  },
  samples: {
    title: '③ Signed samples along the ray',
    text: 'Samples near each return carry a dimensionless signed value — positive on the free side, negative behind the surface — normalised by the per-return truncation 3τ, so different returns may use different physical truncation lengths at the same node. The samples closest to the surface are copied as symmetric pairs in the tangent plane with anisotropic Gaussian weights; a copy keeps its central sample\'s value. Returns without a valid neighbourhood fall back to a ray-orthogonal disc and a global 8&nbsp;cm truncation.',
    eq: ['s=\\operatorname{clip}\\!\\Big(-\\frac{d\\,\\operatorname{clip}(|\\cos\\theta|,0.05,1)}{3\\tau},\\,-1,\\,1\\Big),\\qquad w=(1-0.35|s|)\\,c\\,\\exp\\!\\Big[-\\tfrac12\\big(d_n/\\tau\\big)^2\\Big]'],
  },
  splat: {
    title: '④ Splat to the lattice vertices',
    text: 'Every sample is splatted trilinearly onto the eight corners of its cell in a sparse 4&nbsp;cm GPU lattice. Observations are grouped into one-second blocks, and each node keeps a weighted mean per block.',
    eq: ['\\bar s_{ib}=\\frac{\\sum_{a\\in\\mathcal S_{ib}} w_a\\,s_a}{W_{ib}},\\qquad W_{ib}=\\sum_{a\\in\\mathcal S_{ib}} w_a'],
  },
  evidence: {
    title: '⑤ Temporal-block evidence (TEF core)',
    text: 'Blocks are fused with a bounded weight, so a densely sampled second cannot gain influence from its sample count alone. Separately, each node counts the blocks that saw a surface there (h) and the blocks whose measured rays passed through it (p), each at most once per block; a missing observation is not a pass. On the interior side of the fused field their balance sets a conflict target, and damped Jacobi updates on the changed region regularise the result.',
    eq: [
      '\\omega_{ib}=\\min\\!\\big(\\max_{a} w_a,\\;W_{ib}\\big),\\qquad s_{0,i}=\\frac{\\sum_b\\omega_{ib}\\,\\bar s_{ib}}{\\sum_b\\omega_{ib}}',
      '\\tilde s_i=-\\max\\!\\big(|s_{0,i}|,\\epsilon\\big)\\,\\frac{h_i-p_i}{h_i+p_i}\\quad\\text{if } s_{0,i}\\le 0,\\qquad c_i=\\frac{h_i+p_i}{3}',
      'E(\\mathbf s)=\\sum_i d_i\\,c_i\\,(s_i-\\tilde s_i)^2+\\lambda\\!\\sum_{(i,j)\\in\\mathcal E}(s_i-s_j)^2,\\qquad \\lambda=0.3',
    ],
  },
  mesh: {
    title: '⑥ Surface Nets extraction',
    text: 'The mesh is extracted from the revised field with Surface Nets after node-weight, observed-corner, crossing-probability and face-quality checks. Sparse GPU storage, local remeshing and tiled final extraction keep the process incremental.',
    eq: ['\\mathcal M_{\\mathrm{bg}}^{\\le t}=\\operatorname{SurfaceNets}\\big(\\mathbf s^{*}\\big)'],
  },
  objects: {
    title: 'Object branch · rigid vehicles',
    text: 'A confirmed object keeps its identity — and keeps receiving its observations — when it stops. Its 4-DoF state is estimated by robust point-to-plane registration against a fixed initial object mesh; an optional image step runs 30 bounded Adam updates on tracked, mesh-anchored features and is accepted only after image and geometry checks. Shape is fused into an object-local TSDF (3&nbsp;cm grid) only after an accepted LiDAR registration, and each object mesh is placed in the world at its timestamp.',
    eq: [
      '\\boldsymbol\\xi_t=(x,y,z,\\psi),\\qquad \\boldsymbol\\xi=\\boldsymbol\\xi_{\\mathrm{base}}+D\\tanh\\mathbf a',
      '\\mathcal M(t)=\\mathcal M_{\\mathrm{bg}}^{\\le t}\\;\\cup\\;\\bigcup_{k\\in\\mathcal O_t} T_{WO_k}(t)\\,\\mathcal M_{O_k}^{\\le t}',
    ],
  },
};

function renderMath(tex) {
  const el = document.createElement('div');
  el.className = 'eq';
  if (window.katex) window.katex.render(tex, el, { displayMode: true, throwOnError: false });
  else el.textContent = tex;
  return el;
}

export function initMethod(root) {
  const detail = root.querySelector('#stage-detail');
  const stages = [...root.querySelectorAll('.stage')];
  const show = key => {
    const s = STAGES[key];
    stages.forEach(g => g.classList.toggle('active', g.dataset.stage === key));
    detail.innerHTML = `<h3>${s.title}</h3><p>${s.text}</p>`;
    s.eq.forEach(tex => detail.appendChild(renderMath(tex)));
  };
  stages.forEach(g => {
    g.addEventListener('click', () => show(g.dataset.stage));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(g.dataset.stage); } });
  });
  show('evidence');
}

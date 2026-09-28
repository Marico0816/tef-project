import { initMethod } from './method.js';
import { StaticComparison } from './static_viewer.js';
import { DynamicViewer } from './dynamic_viewer.js';
import { VideoGallery } from './videos.js';
import { initLightbox } from './gallery.js';

// Chapter buttons jump to page sections until the overview video exists.
document.querySelectorAll('.chapters button').forEach(b =>
  b.addEventListener('click', () => document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));

document.querySelectorAll('.collapsible h2').forEach(h => {
  const toggle = () => {
    const box = h.parentElement;
    box.classList.toggle('active');
    h.setAttribute('aria-expanded', String(box.classList.contains('active')));
  };
  h.addEventListener('click', toggle);
  h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
});

initMethod(document.getElementById('method'));
initLightbox();

// The result video only downloads and plays while its card is on screen.
const videos = new VideoGallery(document.getElementById('videos'));
new IntersectionObserver(entries => videos.setVisible(entries.some(e => e.isIntersecting)), { threshold: 0.2 })
  .observe(document.getElementById('videos'));

// Viewers start loading shortly before they scroll into view and only render while visible.
function lazy(el, factory) {
  let viewer = null;
  new IntersectionObserver(entries => {
    const on = entries.some(e => e.isIntersecting);
    if (on && !viewer) {
      viewer = factory();
      viewer.init().catch(err => {
        console.error(err);
        viewer.showMessage('Could not load this example. Serve the page over HTTP (see README).');
      });
    }
    if (viewer) viewer.setVisible(on);
  }, { rootMargin: '300px 0px' }).observe(el);
}

lazy(document.getElementById('static-results'), () => new StaticComparison(document.getElementById('static-results')));
lazy(document.getElementById('dynamic-results'), () => new DynamicViewer(document.getElementById('dynamic-results')));

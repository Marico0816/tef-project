// Click-to-enlarge for figures: any img.zoomable opens in a full-window lightbox with its caption.
export function initLightbox() {
  const box = document.getElementById('lightbox');
  const img = box.querySelector('img');
  const cap = box.querySelector('.lightbox-caption');
  const close = () => { box.hidden = true; img.removeAttribute('src'); document.body.style.overflow = ''; };
  document.querySelectorAll('img.zoomable').forEach(el => {
    el.addEventListener('click', () => {
      img.src = el.currentSrc || el.src;
      img.alt = el.alt;
      const fc = el.closest('figure')?.querySelector('figcaption');
      cap.innerHTML = fc ? fc.innerHTML : '';
      box.hidden = false;
      document.body.style.overflow = 'hidden';
    });
  });
  box.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });
}

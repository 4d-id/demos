/* Optional enhancements: the complete library and articles work without JS. */
(() => {
  const grid = document.getElementById('post-grid');
  if (grid) {
    const cards = [...grid.querySelectorAll('.post')];
    const filters = [...document.querySelectorAll('[data-filter]')];
    const count = document.querySelector('.result-count');
    const apply = (category) => {
      if (!filters.some(button => button.dataset.filter === category)) category = 'all';
      filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === category)));
      cards.forEach((card, index) => {
        card.hidden = category !== 'all' && card.dataset.category !== category;
        card.classList.toggle('post-featured', category === 'all' && index === 0);
      });
      const visible = cards.filter(card => !card.hidden).length;
      count.textContent = `${visible} ${visible === 1 ? 'article' : 'articles'}`;
    };
    filters.forEach(button => button.addEventListener('click', () => {
      const category = button.dataset.filter;
      apply(category);
      const url = new URL(location.href);
      if (category === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', category);
      history.replaceState(null, '', url);
    }));
    apply(new URL(location.href).searchParams.get('category') || 'all');
    document.querySelector('.filters').hidden = false;
  }
  const progress = document.querySelector('.reading-progress');
  const article = document.querySelector('article');
  if (progress && article) {
    let queued = false;
    const update = () => {
      const start = article.getBoundingClientRect().top + window.scrollY;
      const distance = article.offsetHeight - window.innerHeight;
      const ratio = distance > 0 ? (window.scrollY - start) / distance : Number(window.scrollY >= start);
      progress.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
      queued = false;
    };
    const schedule = () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    };
    window.addEventListener('scroll', schedule, {passive: true});
    window.addEventListener('resize', schedule);
    update();
  }
})();

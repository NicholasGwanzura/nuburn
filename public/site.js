/* Home page catalog: loads products from the store API, with search and category filters.
   Links like /?category=clothing#catalog and /?q=shirt work from any page; on the home page they filter in place. */
(() => {
  const { api, escapeHtml, productVisual, priceHtml, settingsReady } = window.Nuburn;
  const grid = document.querySelector('#product-grid');
  const search = document.querySelector('#product-search');
  const filterRow = document.querySelector('#filter-row');
  const catalog = document.querySelector('#catalog');
  const NEW_IN_COUNT = 8;
  const params = new URLSearchParams(location.search);
  let products = [];
  let newIds = new Set();
  let currentFilter = params.get('category') || 'all';
  if (search && params.get('q')) search.value = params.get('q');

  const label = (category) => category.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
  const inStockThenNewest = (a, b) => (a.stock <= 0) - (b.stock <= 0) || newestFirst(a, b);

  const card = (item) => `<a class="product-card${item.stock <= 0 ? ' is-sold-out' : ''}" href="/product?slug=${encodeURIComponent(item.slug)}">
      <div class="product-image" style="--product-bg:${escapeHtml(item.background)}">${item.badge ? `<span class="product-tag">${escapeHtml(item.badge)}</span>` : ''}${item.compareAtCents ? '<span class="product-tag product-tag-sale">SALE</span>' : ''}${productVisual(item)}</div>
      <div class="product-info"><div class="product-title-row"><h4>${escapeHtml(item.name)}</h4>${priceHtml(item)}</div>
      <p class="product-meta"><span class="product-sizes">${escapeHtml(item.sizes.join(' · ') || 'One size')}</span><span class="product-stock${item.stock <= 3 ? ' low' : ''}">${escapeHtml(item.availability)}</span></p></div>
    </a>`;

  // Keep the address bar shareable (?category=…&q=…) without reloading.
  const syncUrl = () => {
    const next = new URLSearchParams();
    if (currentFilter !== 'all') next.set('category', currentFilter);
    const term = search?.value.trim();
    if (term) next.set('q', term);
    const query = next.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  };

  const setFilter = (value) => {
    currentFilter = value;
    filterRow.querySelectorAll('.filter-button').forEach((b) => { const active = b.dataset.filter === value; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    render();
    syncUrl();
  };

  const renderFilters = () => {
    const categories = [...new Set(['clothing', 'footwear', ...products.map((p) => p.category)])];
    filterRow.innerHTML = [['all', 'Everything'], ['new', 'New in'], ...categories.map((c) => [c, label(c)])]
      .map(([value, text]) => `<button class="filter-button${value === currentFilter ? ' active' : ''}" data-filter="${escapeHtml(value)}" aria-pressed="${value === currentFilter}">${escapeHtml(text)}</button>`).join('');
  };

  const render = () => {
    if (!products.length) {
      grid.innerHTML = `<div class="empty-catalog"><span class="empty-star" aria-hidden="true">✳</span><h4>The first edit is on its way.</h4><p>Our clothing and footwear collection will be here soon. Get in touch to ask about current pieces, sizes and availability.</p><a href="#contact">Ask us about the collection →</a></div>`;
      return;
    }
    const term = (search?.value || '').trim().toLowerCase();
    let visible = products.filter((item) => (currentFilter === 'all' || (currentFilter === 'new' ? newIds.has(item.id) : item.category === currentFilter))
      && `${item.name} ${item.category} ${item.badge} ${item.description}`.toLowerCase().includes(term));
    if (currentFilter === 'new') visible = visible.sort(inStockThenNewest);
    if (visible.length) { grid.innerHTML = visible.map(card).join(''); return; }
    grid.innerHTML = `<div class="empty-catalog"><h4>No pieces found${term ? ` for “${escapeHtml(term)}”` : ''}.</h4><p>Try another search or browse the full collection.</p><button type="button" class="text-link" data-clear-filters>Show everything →</button></div>`;
  };

  const showCatalog = () => catalog?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  filterRow.addEventListener('click', (e) => { const b = e.target.closest('.filter-button'); if (b) setFilter(b.dataset.filter); });
  grid.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-filters]')) return;
    if (search) search.value = '';
    setFilter('all');
  });

  // Header search: filters live, and brings the results into view on the first keystroke and on Enter.
  let scrolledForSearch = false;
  search?.addEventListener('input', () => {
    render(); syncUrl();
    if (!scrolledForSearch && catalog.getBoundingClientRect().top > innerHeight * 0.6) { scrolledForSearch = true; showCatalog(); }
  });
  search?.addEventListener('blur', () => { scrolledForSearch = false; });
  search?.form?.addEventListener('submit', (e) => { e.preventDefault(); render(); syncUrl(); showCatalog(); search.blur(); });

  // Category links (nav, tiles, footer) filter in place on this page instead of reloading.
  document.querySelectorAll('[data-category-link]').forEach((link) => link.addEventListener('click', (e) => {
    e.preventDefault();
    setFilter(link.dataset.categoryLink);
    showCatalog();
  }));

  grid.innerHTML = '<div class="catalog-loading" aria-label="Loading products"><span></span><span></span><span></span></div>';
  Promise.all([api('/api/products'), settingsReady])
    .then(([items]) => {
      products = items;
      newIds = new Set([...items].sort(newestFirst).slice(0, NEW_IN_COUNT).map((p) => p.id));
      renderFilters(); render();
      if (params.has('category') || params.has('q')) requestAnimationFrame(showCatalog);
    })
    .catch(() => { grid.innerHTML = '<div class="empty-catalog"><h4>We couldn’t load the collection.</h4><p>Please refresh the page in a moment.</p></div>'; });
})();

/* Shared storefront code: API, money formatting, cart (localStorage), cart drawer, header and contact links. */
(() => {
  const CART_KEY = 'nuburn_cart_v1';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  const api = async (url, options = {}) => {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };

  let settings = { currency: 'USD' };
  const settingsReady = api('/api/settings').then((s) => { settings = s; return s; }).catch(() => settings);

  const money = (cents) => {
    const amount = (Number(cents) || 0) / 100;
    // Fixed 'en' locale + narrow symbol so every visitor sees the same "$75" / "$45.50", whatever their browser language.
    const digits = Number(cents) % 100 === 0 ? 0 : 2;
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: settings.currency || 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); }
    catch { return `${settings.currency || ''} ${amount.toFixed(digits)}`.trim(); }
  };

  const productSvg = (category) => category === 'footwear'
    ? '<svg viewBox="0 0 180 150" aria-hidden="true"><path d="M28 83c22-7 39-21 53-46l22 5 18 43c20 8 39 14 55 19 10 4 14 12 14 23H29c-13-12-12-34-1-44z" fill="currentColor"/><path d="M24 125h164" stroke="#f4f0e7" stroke-width="7" stroke-linecap="round"/><path d="M85 43c0 15 9 24 25 31" fill="none" stroke="#f4f0e7" stroke-width="5"/></svg>'
    : '<svg viewBox="0 0 150 170" aria-hidden="true"><path d="m47 26 24-12h18l24 12 32 25-20 33-17-12v83H30V72L13 84 0 51z" fill="currentColor"/><path d="M65 14c1 16 8 25 15 25s14-9 15-25" fill="none" stroke="#f4f0e7" stroke-width="5"/><path d="M79 45v105" stroke="#f4f0e7" stroke-width="3" opacity=".6"/></svg>';

  // Image for a product: the uploaded cover photo, or the illustrated placeholder.
  const productVisual = (item, className = '') => item.images?.length
    ? `<img class="product-photo ${className}" src="${escapeHtml(item.images[0].url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : `<span class="product-illustration ${className}" style="--product-accent:${escapeHtml(item.accent)}">${productSvg(item.category)}</span>`;

  const priceHtml = (item) => `<span class="product-price">${item.compareAtCents ? `<s>${money(item.compareAtCents)}</s>` : ''}${money(item.priceCents)}</span>`;

  // ---------- cart ----------
  const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
  const writeCart = (items) => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {}
    document.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
  };
  const cart = {
    items: readCart,
    count: () => readCart().reduce((n, i) => n + i.qty, 0),
    subtotal: () => readCart().reduce((n, i) => n + i.priceCents * i.qty, 0),
    add(product, size, qty = 1) {
      const items = readCart();
      const existing = items.find((i) => i.productId === product.id && i.size === size);
      const stock = size && Object.hasOwn(product.stockBySize || {}, size) ? Number(product.stockBySize[size]) : product.stock;
      if (existing) { existing.qty = Math.min(existing.qty + qty, stock, 20); existing.stock = stock; existing.stockBySize = product.stockBySize || {}; }
      else items.push({ productId: product.id, slug: product.slug, name: product.name, priceCents: product.priceCents, image: product.images?.[0]?.url || '', category: product.category, accent: product.accent, background: product.background, size, qty: Math.min(qty, stock), stock, stockBySize: product.stockBySize || {} });
      writeCart(items);
    },
    setQty(index, qty) {
      const items = readCart();
      if (!items[index]) return;
      if (qty <= 0) items.splice(index, 1); else items[index].qty = Math.min(qty, items[index].stock || 20, 20);
      writeCart(items);
    },
    clear: () => writeCart([])
  };

  const cartLineHtml = (item, index) => `<li class="bag-line">
      <a class="bag-thumb" href="/product?slug=${encodeURIComponent(item.slug)}" style="--product-bg:${escapeHtml(item.background)}">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : `<span class="product-illustration" style="--product-accent:${escapeHtml(item.accent)}">${productSvg(item.category)}</span>`}</a>
      <div class="bag-line-info">
        <a href="/product?slug=${encodeURIComponent(item.slug)}"><strong>${escapeHtml(item.name)}</strong></a>
        ${item.size ? `<span>Size ${escapeHtml(item.size)}</span>` : ''}
        <div class="qty" role="group" aria-label="Quantity for ${escapeHtml(item.name)}"><button type="button" data-qty="${index}" data-step="-1" aria-label="Decrease quantity">−</button><span>${item.qty}</span><button type="button" data-qty="${index}" data-step="1" aria-label="Increase quantity">+</button></div>
      </div>
      <div class="bag-line-end"><span>${money(item.priceCents * item.qty)}</span><button type="button" class="bag-remove" data-remove="${index}">Remove</button></div>
    </li>`;

  // ---------- drawer ----------
  const drawer = document.createElement('div');
  drawer.className = 'bag-drawer';
  drawer.hidden = true;
  drawer.innerHTML = `<div class="bag-backdrop" data-close-bag></div>
    <aside class="bag-panel" role="dialog" aria-modal="true" aria-labelledby="bag-title">
      <div class="bag-head"><h2 id="bag-title">Your Bag</h2><button type="button" class="bag-close" data-close-bag aria-label="Close bag">✕</button></div>
      <ul class="bag-lines"></ul>
      <div class="bag-foot"><div class="bag-total"><span>Subtotal</span><strong></strong></div><p class="bag-note">Prices shown are final item prices. Delivery and payment are confirmed with you after you send your order.</p><a class="button button-dark bag-checkout" href="/checkout">Review &amp; Order</a></div>
    </aside>`;
  document.body.appendChild(drawer);

  const renderDrawer = () => {
    const items = readCart();
    drawer.querySelector('.bag-lines').innerHTML = items.length ? items.map(cartLineHtml).join('') : '<li class="bag-empty"><p>Your Bag Is Empty.</p><a class="text-link" href="/shop#catalog" data-close-bag>Explore the Edit →</a></li>';
    drawer.querySelector('.bag-total strong').textContent = money(cart.subtotal());
    drawer.querySelector('.bag-foot').hidden = !items.length;
    document.querySelectorAll('[data-cart-count]').forEach((el) => { const n = cart.count(); el.textContent = n; el.hidden = !n; });
  };
  let lastFocus = null;
  const openBag = () => { lastFocus = document.activeElement; renderDrawer(); drawer.hidden = false; requestAnimationFrame(() => drawer.classList.add('open')); drawer.querySelector('.bag-close').focus(); document.body.style.overflow = 'hidden'; };
  const closeBag = () => { drawer.classList.remove('open'); document.body.style.overflow = ''; setTimeout(() => { drawer.hidden = true; }, 250); lastFocus?.focus?.(); };

  // Quantity/remove buttons work in both the drawer and the checkout page.
  document.addEventListener('click', (e) => {
    const qtyBtn = e.target.closest('[data-qty]');
    if (qtyBtn) { const i = Number(qtyBtn.dataset.qty); cart.setQty(i, readCart()[i].qty + Number(qtyBtn.dataset.step)); return; }
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) { cart.setQty(Number(removeBtn.dataset.remove), 0); return; }
    if (e.target.closest('[data-open-bag]')) { e.preventDefault(); openBag(); return; }
    if (e.target.closest('[data-close-bag]')) closeBag();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeBag(); });
  document.addEventListener('cart:change', renderDrawer);
  window.addEventListener('storage', (e) => { if (e.key === CART_KEY) renderDrawer(); });

  // ---------- header, contact, footer ----------
  const contactDefaults = {phone:'Business phone coming soon',whatsapp:'WhatsApp number coming soon',email:'Email address coming soon',address:'Address to be confirmed',instagram:'Instagram page coming soon',facebook:'Facebook page coming soon'};
  const ICON_PIN = '<svg class="office-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>';
  const ICON_PHONE = '<svg class="office-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 7.2 7.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 5.7a2 2 0 0 1 2-2.2z"/></svg>';
  settingsReady.then((contact) => {
    renderDrawer();
    document.querySelectorAll('[data-office-directory]').forEach((container) => {
      const offices = Array.isArray(contact.offices) ? contact.offices : [];
      if (!offices.length) { container.hidden = true; return; }
      const heading = document.createElement('div');
      heading.className = 'office-directory-heading';
      heading.innerHTML = '<p class="eyebrow">FIND NUBURN</p><h2>Our <em>Offices.</em></h2>';
      const grid = document.createElement('div');
      grid.className = 'office-directory-grid';
      for (const office of offices) {
        const card = document.createElement('article');
        card.className = 'office-card';
        const title = document.createElement('h3'); title.textContent = office.city || 'Office'; card.append(title);
        const address = document.createElement('p'); address.className = 'office-address';
        address.innerHTML = ICON_PIN; const addressText = document.createElement('span'); addressText.textContent = office.address || ''; address.append(addressText); card.append(address);
        for (const contactItem of office.phones || []) {
          const phone = document.createElement('a');
          phone.className = 'office-phone';
          phone.href = `tel:${String(contactItem.number || '').replace(/[^+\d]/g, '')}`;
          phone.innerHTML = ICON_PHONE; const phoneText = document.createElement('span'); phoneText.textContent = contactItem.label ? `${contactItem.label}: ${contactItem.number}` : contactItem.number || ''; phone.append(phoneText);
          card.append(phone);
        }
        grid.append(card);
      }
      container.replaceChildren(heading, grid);
    });
    document.querySelectorAll('[data-contact]').forEach((link) => {
      const type = link.dataset.contact;
      const value = (contact[type] || '').trim();
      const label = link.querySelector('[data-value]');
      if (!value && link.hasAttribute('data-hide-empty')) { link.hidden = true; return; }
      if (value) {
        if (label && !link.hasAttribute('data-keep-label')) label.textContent = value;
        if (type === 'phone') link.href = `tel:${value.replace(/[^+\d]/g,'')}`;
        else if (type === 'whatsapp') link.href = `https://wa.me/${value.replace(/\D/g,'')}`;
        else if (type === 'email') link.href = `mailto:${value}`;
        else if (type === 'instagram' || type === 'facebook') { link.href = value; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      } else if (label) label.textContent = contactDefaults[type];
    });
    // Hide a contact block entirely when none of its details are set yet.
    document.querySelectorAll('[data-contact-group]').forEach((group) => { group.hidden = ![...group.querySelectorAll('[data-contact]')].some((el) => !el.hidden); });
    // Main "talk to us" button: WhatsApp if set, else email, else phone, else hidden.
    const wa = document.querySelector('#whatsapp-link');
    const whatsapp = (contact.whatsapp || '').replace(/\D/g,'');
    if (wa) {
      const setButton = (href, text) => { wa.href = href; wa.firstChild.textContent = `${text} `; wa.hidden = false; };
      if (whatsapp) { setButton(`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hi Nuburn Designs, I’d love to ask about the collection.')}`, 'Chat with Us on WhatsApp'); wa.target = '_blank'; wa.rel = 'noopener'; }
      else if (contact.email) setButton(`mailto:${contact.email}`, 'Email us');
      else if (contact.phone) setButton(`tel:${contact.phone.replace(/[^+\d]/g,'')}`, 'Call us');
    }
    const bar = document.querySelector('#announcement');
    if (bar && contact.announcement) { bar.textContent = contact.announcement; bar.hidden = false; }
    document.dispatchEvent(new CustomEvent('settings:ready', { detail: contact }));
  });

  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();
  const header = document.querySelector('[data-site-header]');
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#primary-nav');
  const searchPanel = document.querySelector('#site-search');
  const searchInput = document.querySelector('#product-search');

  // Highlight the current section in the main nav.
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const section = path === '/imported-clothing' || path === '/manufacturing/imported-clothing' ? 'imports'
    : path === '/' || path.startsWith('/manufacturing') ? 'manufacturing'
    : /^\/(shop|product|checkout|index)/.test(path) ? 'shop'
    : path.startsWith('/story') ? 'story' : '';
  nav?.querySelector(`[data-nav="${section}"]`)?.setAttribute('aria-current', 'page');

  // Transparent header over the page's hero photo; solid white once scrolled or a panel is open.
  const hasHero = Boolean(document.querySelector('.page-hero'));
  document.body.classList.toggle('has-page-hero', hasHero);
  const syncHeader = () => {
    if (!header) return;
    const open = nav?.classList.contains('open') || (searchPanel && !searchPanel.hidden);
    header.classList.toggle('is-solid', !hasHero || open || window.scrollY > 24);
  };
  window.addEventListener('scroll', syncHeader, { passive: true });
  syncHeader();

  const heroSlider = document.querySelector('[data-hero-slider]');
  if (heroSlider) {
    const slides = [...heroSlider.querySelectorAll('[data-hero-slide]')];
    const backgrounds = [...heroSlider.querySelectorAll('[data-hero-background]')];
    const status = heroSlider.querySelector('[data-hero-status]');
    let activeSlide = 0;
    const showSlide = (index) => {
      activeSlide = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => { slide.hidden = i !== activeSlide; });
      backgrounds.forEach((img, i) => { img.hidden = i !== activeSlide - 1; });
      heroSlider.querySelectorAll('[data-hero-go]').forEach((button, i) => button.setAttribute('aria-current', String(i === activeSlide)));
      heroSlider.setAttribute('aria-labelledby', activeSlide ? 'imported-hero-title' : 'manufacturing-title');
      if (status) status.textContent = `0${activeSlide + 1} / 0${slides.length}`;
    };
    heroSlider.querySelector('[data-hero-prev]')?.addEventListener('click', () => showSlide(activeSlide - 1));
    heroSlider.querySelector('[data-hero-next]')?.addEventListener('click', () => showSlide(activeSlide + 1));
    heroSlider.querySelectorAll('[data-hero-go]').forEach((button) => button.addEventListener('click', () => showSlide(Number(button.dataset.heroGo))));
    heroSlider.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        showSlide(activeSlide + (event.key === 'ArrowRight' ? 1 : -1));
      }
    });
    showSlide(0);
  }

  const setMenu = (open) => {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    syncHeader();
  };
  const setSearch = (open) => {
    if (!searchPanel) return;
    searchPanel.hidden = !open;
    document.querySelectorAll('[data-search-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) { setMenu(false); searchInput?.focus(); }
    syncHeader();
  };
  toggle?.addEventListener('click', () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; if (open) setSearch(false); setMenu(open); });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
  document.querySelectorAll('[data-search-toggle]').forEach((b) => b.addEventListener('click', () => setSearch(searchPanel.hidden)));
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; setMenu(false); if (searchPanel && !searchPanel.hidden) setSearch(false); });
  if (searchInput && new URLSearchParams(location.search).get('q')) setSearch(true);

  // Staggered reveal for [data-reveal] lists as they scroll into view.
  const revealGroups = document.querySelectorAll('[data-reveal]');
  if (revealGroups.length && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('reveal-armed');
    const io = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.15 });
    revealGroups.forEach((group) => [...group.children].forEach((child, i) => { child.style.setProperty('--i', i); io.observe(child); }));
  }

  window.Nuburn = { api, money, cart, escapeHtml, productVisual, priceHtml, productSvg, openBag, settingsReady, get settings() { return settings; } };
})();

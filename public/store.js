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
      <div class="bag-head"><h2 id="bag-title">Your bag</h2><button type="button" class="bag-close" data-close-bag aria-label="Close bag">✕</button></div>
      <ul class="bag-lines"></ul>
      <div class="bag-foot"><div class="bag-total"><span>Subtotal</span><strong></strong></div><p class="bag-note">Prices shown are final item prices. Delivery and payment are confirmed with you after you send your order.</p><a class="button button-dark bag-checkout" href="/checkout">Review &amp; order <span aria-hidden="true">↗</span></a></div>
    </aside>`;
  document.body.appendChild(drawer);

  const renderDrawer = () => {
    const items = readCart();
    drawer.querySelector('.bag-lines').innerHTML = items.length ? items.map(cartLineHtml).join('') : '<li class="bag-empty"><span aria-hidden="true">✳</span><p>Your bag is empty.</p><a class="text-link" href="/#catalog" data-close-bag>Explore the edit →</a></li>';
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
  settingsReady.then((contact) => {
    renderDrawer();
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
      if (whatsapp) { setButton(`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hi Nuburn Designs, I’d love to ask about the collection.')}`, 'Chat with us on WhatsApp'); wa.target = '_blank'; wa.rel = 'noopener'; }
      else if (contact.email) setButton(`mailto:${contact.email}`, 'Email us');
      else if (contact.phone) setButton(`tel:${contact.phone.replace(/[^+\d]/g,'')}`, 'Call us');
    }
    const bar = document.querySelector('#announcement');
    if (bar && contact.announcement) { bar.textContent = contact.announcement; bar.hidden = false; }
    document.dispatchEvent(new CustomEvent('settings:ready', { detail: contact }));
  });

  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#primary-nav');
  toggle?.addEventListener('click', () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded',String(open)); toggle.setAttribute('aria-label',open?'Close menu':'Open menu'); nav.classList.toggle('open',open); });
  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { toggle?.setAttribute('aria-expanded','false'); toggle?.setAttribute('aria-label','Open menu'); nav.classList.remove('open'); }));

  window.Nuburn = { api, money, cart, escapeHtml, productVisual, priceHtml, productSvg, openBag, settingsReady, get settings() { return settings; } };
})();

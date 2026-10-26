/* Nuburn admin: sign-in, products (with photo uploads), orders and settings. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const api = async (url, options = {}) => {
    const isForm = options.body instanceof FormData;
    const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Please sign in again.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  };

  let currency = 'USD';
  let settings = {};
  const money = (cents) => {
    const digits = Number(cents) % 100 === 0 ? 0 : 2;
    try { return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format((cents || 0) / 100); }
    catch { return `${currency} ${((cents || 0) / 100).toFixed(digits)}`; }
  };
  const toast = (msg, isError = false) => {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('toast-error', isError); t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  };
  const baseTitle = document.title;
  let alertTimer = null;

  // ---------- auth ----------
  const showLogin = () => { clearInterval(alertTimer); document.title = baseTitle; $('#app-view').hidden = true; $('#login-view').hidden = false; $('#login-form [name=password]').focus(); };
  const showApp = async () => { await loadSettings(); $('#login-view').hidden = true; $('#app-view').hidden = false; switchTab(location.hash.slice(1) || 'dashboard'); startOrderAlerts(); };

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error'); err.hidden = true;
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) }); e.target.reset(); await showApp(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  $('#logout').addEventListener('click', async () => { clearInterval(alertTimer); await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  // ---------- tabs ----------
  const loaders = { dashboard: loadDashboard, products: loadProducts, orders: loadOrders, settings: loadSettings };
  function switchTab(name) {
    if (!loaders[name]) name = 'dashboard';
    $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    history.replaceState(null, '', `#${name}`);
    loaders[name]().catch((e) => toast(e.message, true));
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.addEventListener('click', (e) => { const go = e.target.closest('[data-goto]'); if (go) switchTab(go.dataset.goto); });

  // ---------- dashboard ----------
  async function loadDashboard() {
    const s = await api('/api/admin/stats');
    $('#stats').innerHTML = [
      ['Products', s.products.total], ['Live in store', s.products.live], ['Sold out', s.products.soldOut], ['Awaiting payment', s.orders.awaiting]
    ].map(([label, n]) => `<div class="stat"><span>${label}</span><strong>${n}</strong></div>`).join('');
    updateOrderBadge(s);
    $('#contact-warning').hidden = Boolean(settings.whatsapp || settings.phone || settings.email);
    renderAlertButton();
  }

  // ---------- new-order alerts ----------
  // While the admin is open, check for new orders every 45s: badge, tab title, toast and (if allowed) a system notification.
  const SEEN_KEY = 'nuburn_admin_seen_order';
  const readSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
  const writeSeen = (id) => { try { localStorage.setItem(SEEN_KEY, String(id)); } catch {} };
  function updateOrderBadge(s) {
    const pill = $('#orders-pill'); pill.textContent = s.orders.awaiting; pill.hidden = !s.orders.awaiting;
    document.title = s.orders.awaiting ? `(${s.orders.awaiting}) ${baseTitle}` : baseTitle;
  }

  async function checkForOrders() {
    const s = await api('/api/admin/stats');
    updateOrderBadge(s);
    const seen = readSeen();
    if (!seen) { writeSeen(s.orders.latestId); return; }
    if (s.orders.latestId > seen) {
      writeSeen(s.orders.latestId);
      toast('New order received');
      if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification('New Nuburn order', { body: 'A customer just sent an order request.', icon: '/favicon.svg' });
        n.onclick = () => { window.focus(); switchTab('orders'); };
      }
      if (!$('[data-panel="orders"]').hidden) loadOrders().catch(() => {});
    }
  }
  const startOrderAlerts = () => { clearInterval(alertTimer); checkForOrders().catch(() => {}); alertTimer = setInterval(() => checkForOrders().catch(() => {}), 45000); };

  function renderAlertButton() {
    const btn = $('#enable-alerts');
    const supported = 'Notification' in window;
    btn.hidden = !supported || Notification.permission !== 'default';
  }
  $('#enable-alerts').addEventListener('click', async () => {
    const result = await Notification.requestPermission();
    toast(result === 'granted' ? 'Order alerts are on' : 'Alerts blocked — you can allow them in your browser settings', result !== 'granted');
    renderAlertButton();
  });

  // ---------- products ----------
  let products = [];
  async function loadProducts() {
    [products, categories] = await Promise.all([api('/api/admin/products'), api('/api/admin/categories')]);
    renderCategoryOptions(); renderProducts();
  }
  let categories = [];
  function renderCategoryOptions() {
    const filter = $('#product-category-filter');
    const selected = filter.value;
    filter.innerHTML = '<option value="">All categories</option>' + categories.map((c) => `<option value="${esc(c.category)}">${esc(c.category)} (${c.products})</option>`).join('');
    filter.value = selected;
    $('#category-options').innerHTML = [...new Set(['clothing', 'footwear', 'accessories', ...categories.map((c) => c.category)])]
      .map((value) => `<option value="${esc(value)}">`).join('');
    $('#category-list').innerHTML = categories.length ? categories.map((c) => `<form class="category-row" data-category="${esc(c.category)}"><label>${esc(c.category)} <small>${c.products} product${c.products === 1 ? '' : 's'}</small><input name="name" value="${esc(c.category)}" required maxlength="60" aria-label="Rename ${esc(c.category)}"></label><button type="submit" class="btn btn-small">Rename</button></form>`).join('') : '<p class="empty">Categories will appear here when you add products.</p>';
  }
  function renderProducts() {
    const term = $('#product-filter').value.trim().toLowerCase();
    const category = $('#product-category-filter').value;
    const status = $('#product-status-filter').value;
    const rows = products.filter((p) => `${p.name} ${p.category} ${p.badge}`.toLowerCase().includes(term)
      && (!category || p.category === category)
      && (!status || (status === 'published' && p.published) || (status === 'draft' && !p.published)
        || (status === 'sold-out' && p.stock <= 0) || (status === 'low-stock' && p.stock > 0 && p.stock <= 3)));
    $('#products-table tbody').innerHTML = rows.length ? rows.map((p) => `<tr data-id="${p.id}">
        <td><div class="thumb" style="background:${esc(p.background)}">${p.images[0] ? `<img src="${esc(p.images[0].url)}" alt="">` : ''}</div></td>
        <td><strong>${esc(p.name)}</strong>${p.featured ? ' <span class="tag">Featured</span>' : ''}<br><small>${esc(p.sizes.join(', ') || 'One size')}</small></td>
        <td>${esc(p.category)}</td>
        <td>${money(p.priceCents)}${p.compareAtCents ? `<br><small><s>${money(p.compareAtCents)}</s></small>` : ''}</td>
        <td class="${p.stock <= 0 ? 'danger' : p.stock <= 3 ? 'warn' : ''}"><div class="stock-tools"><strong>${p.stock}</strong>${Object.keys(p.stockBySize || {}).length ? `<small>${Object.entries(p.stockBySize).map(([size, count]) => `${esc(size)}: ${count}`).join(' · ')}</small><button type="button" class="link-btn" data-edit="${p.id}">Sizes</button>` : `<input type="number" min="0" step="1" value="${p.stock}" data-stock-value="${p.id}" aria-label="New stock for ${esc(p.name)}"><button type="button" class="btn btn-small" data-save-stock="${p.id}">Update</button>`}<button type="button" class="link-btn" data-stock-history="${p.id}">History</button></div></td>
        <td><span class="status ${p.published ? 'status-live' : ''}">${p.published ? 'Live' : 'Draft'}</span></td>
        <td class="row-actions">${p.published ? `<a href="/product?slug=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">View</a>` : ''}<button type="button" class="btn btn-small" data-edit="${p.id}">Edit</button></td>
      </tr>`).join('') : `<tr><td colspan="7" class="empty">${products.length ? 'No products match your search.' : 'No products yet. Add your first one.'}</td></tr>`;
  }
  $('#product-filter').addEventListener('input', renderProducts);
  $('#product-category-filter').addEventListener('change', renderProducts);
  $('#product-status-filter').addEventListener('change', renderProducts);
  $('#category-list').addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-category]')) return;
    e.preventDefault();
    const oldName = e.target.dataset.category;
    const name = e.target.elements.name.value;
    try {
      const result = await api(`/api/admin/categories/${encodeURIComponent(oldName)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      await loadProducts();
      toast(`Category renamed to ${result.category}`);
    } catch (ex) { toast(ex.message, true); }
  });
  $('#products-table').addEventListener('click', async (e) => {
    const historyButton = e.target.closest('[data-stock-history]');
    if (historyButton) {
      const id = Number(historyButton.dataset.stockHistory);
      try {
        const entries = await api(`/api/admin/products/${id}/stock-history`);
        $('#stock-history-list').innerHTML = entries.length ? entries.map((entry) => `<article><strong>${entry.previousStock} → ${entry.newStock}</strong><span>${esc(entry.reason || 'Stock adjustment')}</span><time>${new Date(entry.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}</time></article>`).join('') : '<p class="empty">No stock adjustments recorded.</p>';
        $('#stock-history-dialog').showModal();
      } catch (ex) { toast(ex.message, true); }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEditor(products.find((p) => p.id === Number(edit.dataset.edit))); return; }
    const button = e.target.closest('[data-save-stock]');
    if (!button) return;
    const id = Number(button.dataset.saveStock);
    const input = $(`[data-stock-value="${id}"]`);
    button.disabled = true;
    try {
      const reason = window.prompt('Reason for stock adjustment (optional):', 'Stock count update');
      if (reason === null) return;
      const result = await api(`/api/admin/products/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ stock: Number(input.value), reason }) });
      const product = products.find((p) => p.id === id);
      if (product) product.stock = result.stock;
      renderProducts(); toast(`Stock updated: ${result.previousStock} → ${result.stock}`);
    } catch (ex) { toast(ex.message, true); }
    finally { button.disabled = false; }
  });
  $('[data-close-history]').addEventListener('click', () => $('#stock-history-dialog').close());
  $('#export-products').addEventListener('click', () => { window.location.href = '/api/admin/products/export.csv'; });
  $('#import-products').addEventListener('click', () => $('#product-csv-input').click());
  $('#product-csv-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const result = await api('/api/admin/products/import', { method: 'POST', body: await file.text(), headers: { 'Content-Type': 'text/csv' } });
      await loadProducts();
      toast(`Import complete: ${result.created} added, ${result.updated} updated`);
    } catch (ex) { toast(ex.message, true); }
  });
  $$('[data-new-product]').forEach((b) => b.addEventListener('click', () => { switchTab('products'); openEditor(null); }));

  // ---------- product editor ----------
  const editor = $('#editor');
  const form = $('#product-form');
  let editing = null;      // product being edited (null = new)
  let pendingFiles = [];   // photos chosen before a new product is first saved

  function syncVariantStock() {
    const variantField = form.elements.stockBySize;
    const totalField = form.elements.stock;
    totalField.disabled = Boolean(variantField.value.trim());
  }
  form.elements.stockBySize.addEventListener('input', syncVariantStock);

  const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2));

  function openEditor(product) {
    editing = product;
    pendingFiles = [];
    form.reset();
    $('#editor-error').hidden = true;
    $('#editor-title').textContent = product ? 'Edit product' : 'New product';
    $('#delete-product').hidden = !product;
    if (product) {
      form.elements.namedItem('name').value = product.name;
      form.price.value = centsToInput(product.priceCents);
      form.compareAt.value = centsToInput(product.compareAtCents);
      form.category.value = product.category;
      form.stock.value = product.stock;
      form.sizes.value = product.sizes.join(', ');
      form.stockBySize.value = Object.entries(product.stockBySize || {}).map(([size, quantity]) => `${size}: ${quantity}`).join('\n');
      form.description.value = product.description;
      form.badge.value = product.badge;
      form.background.value = product.background;
      form.accent.value = product.accent;
      form.published.checked = product.published;
      form.featured.checked = product.featured;
    }
    syncVariantStock();
    renderImages();
    editor.showModal();
    form.elements.namedItem('name').focus();
  }

  function renderImages() {
    const saved = editing?.images || [];
    const html = saved.map((img, i) => `<figure class="image-item" data-image="${img.id}">
        <img src="${esc(img.url)}" alt="">${i === 0 ? '<span class="cover">Cover</span>' : ''}
        <figcaption><button type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left">←</button><button type="button" data-move="1" ${i === saved.length - 1 ? 'disabled' : ''} aria-label="Move right">→</button><button type="button" data-delete-image aria-label="Delete photo">✕</button></figcaption>
      </figure>`).concat(pendingFiles.map((f, i) => `<figure class="image-item pending" data-pending="${i}"><img src="${URL.createObjectURL(f)}" alt=""><span class="cover">${saved.length + i === 0 ? 'Cover · ' : ''}Not saved</span><figcaption><button type="button" data-remove-pending aria-label="Remove photo">✕</button></figcaption></figure>`));
    $('#image-list').innerHTML = html.join('');
  }

  // Resize large photos in the browser before upload (longest edge 1600px, JPEG ~85%), so the store stays fast on mobile data.
  const MAX_EDGE = 1600;
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !('createImageBitmap' in window)) return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size <= 600 * 1024) { bitmap.close(); return file; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNGs land on the store's white background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    } catch { return file; }
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    $('#dropzone').classList.add('busy');
    const ready = await Promise.all(files.map(shrinkImage));
    const body = new FormData();
    ready.forEach((f) => body.append('images', f));
    $('#dropzone').classList.add('busy');
    try { editing = await api(`/api/admin/products/${editing.id}/images`, { method: 'POST', body }); }
    finally { $('#dropzone').classList.remove('busy'); }
    renderImages();
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    if (!editing) { pendingFiles.push(...files); renderImages(); return; }
    try { await uploadFiles(files); toast(`${files.length} photo${files.length > 1 ? 's' : ''} uploaded`); refreshListQuietly(); }
    catch (e) { toast(e.message, true); }
  }

  $('#image-input').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  $('#image-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.image-item');
    if (!item) return;
    if (e.target.closest('[data-remove-pending]')) { pendingFiles.splice(Number(item.dataset.pending), 1); renderImages(); return; }
    const id = Number(item.dataset.image);
    try {
      if (e.target.closest('[data-delete-image]')) {
        if (!confirm('Delete this photo?')) return;
        editing = await api(`/api/admin/images/${id}`, { method: 'DELETE' });
      } else if (e.target.closest('[data-move]')) {
        const order = editing.images.map((img) => img.id);
        const from = order.indexOf(id);
        const to = from + Number(e.target.closest('[data-move]').dataset.move);
        [order[from], order[to]] = [order[to], order[from]];
        editing = await api(`/api/admin/products/${editing.id}/images/order`, { method: 'PUT', body: JSON.stringify({ order }) });
      } else return;
      renderImages(); refreshListQuietly();
    } catch (ex) { toast(ex.message, true); }
  });

  const refreshListQuietly = () => loadProducts().catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#editor-error'); err.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    data.published = form.published.checked;
    data.featured = form.featured.checked;
    const save = $('#save-product'); save.disabled = true;
    try {
      editing = await api(editing ? `/api/admin/products/${editing.id}` : '/api/admin/products', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) });
      if (pendingFiles.length) { await uploadFiles(pendingFiles); pendingFiles = []; }
      editor.close();
      toast('Product saved');
      loadProducts();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { save.disabled = false; }
  });

  $('#delete-product').addEventListener('click', async () => {
    if (!editing || !confirm(`Delete “${editing.name}” and its photos? This can’t be undone.`)) return;
    try { await api(`/api/admin/products/${editing.id}`, { method: 'DELETE' }); editor.close(); toast('Product deleted'); loadProducts(); }
    catch (ex) { toast(ex.message, true); }
  });
  $$('[data-close]', editor).forEach((b) => b.addEventListener('click', () => editor.close()));

  // ---------- orders ----------
  const STATUS_LABELS = { awaiting_payment: 'Awaiting payment', confirmed: 'Confirmed', fulfilled: 'Fulfilled', cancelled: 'Cancelled' };
  let orders = [];
  async function loadOrders() { orders = await api('/api/admin/orders'); renderOrders(); loadDashboard().catch(() => {}); }
  function renderOrders() {
    const filter = $('#order-filter').value;
    const list = orders.filter((o) => !filter || o.status === filter);
    $('#orders-list').innerHTML = list.length ? list.map((o) => {
      const wa = o.customer_phone.replace(/\D/g, '');
      return `<article class="card order" data-order="${o.id}">
        <header><div><strong>${esc(o.reference)}</strong><small>${new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</small></div>
          <select data-status aria-label="Order status">${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}"${v === o.status ? ' selected' : ''}>${l}</option>`).join('')}</select></header>
        <div class="order-body">
          <div><h3>${esc(o.customer_name)}</h3><p><a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a>${wa ? ` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${o.customer_email ? `<br><a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a>` : ''}</p>
            <p><span class="tag">${o.fulfilment === 'collection' ? 'Collection' : 'Delivery'}</span> ${esc(o.address)}</p>${o.notes ? `<p class="notes">“${esc(o.notes)}”</p>` : ''}</div>
          <ul class="order-lines">${o.items.map((i) => `<li><span>${esc(i.name)}${i.size ? ` · ${esc(i.size)}` : ''} × ${i.qty}</span><span>${money(i.lineCents)}</span></li>`).join('')}<li class="total"><span>Subtotal</span><span>${money(o.subtotal_cents)}</span></li></ul>
        </div></article>`;
    }).join('') : `<div class="card empty">${orders.length ? 'No orders with this status.' : 'No orders yet. They’ll appear here when customers send an order from the store.'}</div>`;
  }
  $('#order-filter').addEventListener('change', renderOrders);
  $('#orders-list').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-status]')) return;
    const id = Number(e.target.closest('[data-order]').dataset.order);
    try { await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }); orders.find((o) => o.id === id).status = e.target.value; toast('Order updated'); loadDashboard().catch(() => {}); }
    catch (ex) { toast(ex.message, true); }
  });

  // ---------- settings ----------
  async function loadSettings() {
    const s = await api('/api/admin/settings');
    settings = s;
    currency = s.currency || 'USD';
    const f = $('#settings-form');
    Object.entries(s).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v; });
  }
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const s = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      settings = s; currency = s.currency; toast('Settings saved');
    } catch (ex) { toast(ex.message, true); }
  });

  api('/api/admin/me').then((r) => (r.signedIn ? showApp() : showLogin())).catch(showLogin);
})();

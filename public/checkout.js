/* Checkout: review bag and send an order request. Payment is collected later (see README). */
(() => {
  const { api, money, cart, escapeHtml, settingsReady } = window.Nuburn;
  const root = document.querySelector('#checkout-root');
  const form = document.querySelector('#checkout-form');
  const error = document.querySelector('#form-error');
  const address = form.querySelector('[data-address]');

  const lineHtml = (item, index) => `<li class="bag-line">
      <a class="bag-thumb" href="/product?slug=${encodeURIComponent(item.slug)}" style="--product-bg:${escapeHtml(item.background)}">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : `<span class="product-illustration" style="--product-accent:${escapeHtml(item.accent)}">${window.Nuburn.productSvg(item.category)}</span>`}</a>
      <div class="bag-line-info"><a href="/product?slug=${encodeURIComponent(item.slug)}"><strong>${escapeHtml(item.name)}</strong></a>${item.size ? `<span>Size ${escapeHtml(item.size)}</span>` : ''}
        <div class="qty" role="group" aria-label="Quantity for ${escapeHtml(item.name)}"><button type="button" data-qty="${index}" data-step="-1" aria-label="Decrease quantity">−</button><span>${item.qty}</span><button type="button" data-qty="${index}" data-step="1" aria-label="Increase quantity">+</button></div></div>
      <div class="bag-line-end"><span>${money(item.priceCents * item.qty)}</span><button type="button" class="bag-remove" data-remove="${index}">Remove</button></div>
    </li>`;

  const render = () => {
    const items = cart.items();
    if (!items.length) {
      root.innerHTML = '<div class="empty-catalog"><span class="empty-star" aria-hidden="true">✳</span><h4>Your bag is empty.</h4><p>Find something you love in the collection.</p><a href="/#catalog">Explore the edit →</a></div>';
      return;
    }
    document.querySelector('#checkout-lines').innerHTML = items.map(lineHtml).join('');
    document.querySelector('#checkout-subtotal').textContent = money(cart.subtotal());
  };

  form.addEventListener('change', () => { address.hidden = form.fulfilment.value === 'collection'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim() || !data.phone.trim()) { error.textContent = 'Please add your name and phone number.'; error.hidden = false; return; }
    if (data.fulfilment === 'delivery' && !data.address.trim()) { error.textContent = 'Please add a delivery address, or choose collection.'; error.hidden = false; return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({ customer: data, items: cart.items().map(({ productId, size, qty }) => ({ productId, size, qty })) }) });
      cart.clear();
      const settings = await settingsReady;
      const wa = (settings.whatsapp || '').replace(/\D/g, '');
      const waText = encodeURIComponent([
        `Hi Nuburn Designs, I’ve just placed order ${order.reference}:`,
        ...order.items.map((i) => `• ${i.name}${i.size ? ` (${i.size})` : ''} × ${i.qty}: ${money(i.lineCents)}`),
        `Total: ${money(order.subtotalCents)}`,
        `${data.fulfilment === 'collection' ? 'Collection' : `Delivery to: ${data.address.trim()}`}`,
        `Name: ${data.name.trim()}`
      ].join('\n'));
      root.innerHTML = `<div class="order-confirmed">
          <span class="empty-star" aria-hidden="true">✳</span>
          <p class="eyebrow">ORDER REQUEST RECEIVED</p>
          <h2>Thank you, ${escapeHtml(data.name.split(' ')[0])}.</h2>
          <p>Your reference is <strong>${escapeHtml(order.reference)}</strong>. We’ll be in touch on ${escapeHtml(data.phone)} to confirm payment and ${data.fulfilment === 'collection' ? 'collection' : 'delivery'}.${wa ? ' For the fastest reply, send us your order on WhatsApp now.' : ''}</p>
          <ul class="confirm-lines">${order.items.map((i) => `<li><span>${escapeHtml(i.name)}${i.size ? ` · ${escapeHtml(i.size)}` : ''} × ${i.qty}</span><span>${money(i.lineCents)}</span></li>`).join('')}<li class="confirm-total"><span>Subtotal</span><span>${money(order.subtotalCents)}</span></li></ul>
          <div class="hero-actions">${wa ? `<a class="button button-dark" href="https://wa.me/${wa}?text=${waText}" target="_blank" rel="noopener">Send my order on WhatsApp <span aria-hidden="true">↗</span></a>` : ''}<a class="text-link" href="/#catalog">Keep shopping →</a></div>
        </div>`;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });

  document.addEventListener('cart:change', render);
  settingsReady.then(render);
})();

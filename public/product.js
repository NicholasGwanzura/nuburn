/* Product detail page: gallery, size picker, quantity and add to bag. */
(() => {
  const { api, escapeHtml, productVisual, priceHtml, cart, openBag, settingsReady } = window.Nuburn;
  const root = document.querySelector('#product-root');
  const slug = new URLSearchParams(location.search).get('slug');

  const notFound = () => {
    root.innerHTML = '<div class="empty-catalog"><span class="empty-star" aria-hidden="true">✳</span><h4>We couldn’t find that piece.</h4><p>It may have sold out or moved. Browse the full collection instead.</p><a href="/#catalog">Back to the shop →</a></div>';
    document.querySelector('#crumb-category').textContent = 'Not found';
  };
  if (!slug) return notFound();

  Promise.all([api(`/api/products/${encodeURIComponent(slug)}`), settingsReady]).then(([p]) => {
    document.querySelector('#crumb-category').textContent = p.category.replace(/-/g, ' ');
    const soldOut = p.stock <= 0;
    const thumbs = p.images.length > 1 ? `<div class="gallery-thumbs">${p.images.map((img, i) => `<button type="button" class="${i ? '' : 'active'}" data-src="${escapeHtml(img.url)}" aria-label="Show image ${i + 1}"><img src="${escapeHtml(img.url)}" alt=""></button>`).join('')}</div>` : '';

    root.innerHTML = `<div class="product-detail">
      <div class="gallery">
        <div class="gallery-main product-image" style="--product-bg:${escapeHtml(p.background)}">${p.badge ? `<span class="product-tag">${escapeHtml(p.badge)}</span>` : ''}${productVisual(p, 'gallery-visual')}</div>
        ${thumbs}
      </div>
      <div class="detail-copy">
        <p class="eyebrow">${escapeHtml(p.category.toUpperCase())}</p>
        <h1>${escapeHtml(p.name)}</h1>
        <div class="detail-price">${priceHtml(p)}</div>
        <p class="detail-stock availability${soldOut ? ' sold-out' : ''}">${escapeHtml(p.availability)}</p>
        ${p.sizes.length ? `<fieldset class="size-picker"><legend>Choose a size</legend>${p.sizes.map((s) => `<label><input type="radio" name="size" value="${escapeHtml(s)}"${p.sizes.length === 1 ? ' checked' : ''}><span>${escapeHtml(s)}</span></label>`).join('')}</fieldset>` : ''}
        <div class="detail-actions">
          <div class="qty qty-large" role="group" aria-label="Quantity"><button type="button" data-step="-1" aria-label="Decrease quantity">−</button><span id="detail-qty">1</span><button type="button" data-step="1" aria-label="Increase quantity">+</button></div>
          <button class="button button-dark" id="add-to-bag" type="button"${soldOut ? ' disabled' : ''}>${soldOut ? 'Sold out' : 'Add to bag <span aria-hidden="true">↗</span>'}</button>
        </div>
        <p class="form-error" id="size-error" role="alert" hidden>Please choose a size first.</p>
        ${p.description ? `<div class="detail-description">${escapeHtml(p.description).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
        <ul class="detail-notes"><li>Payment and delivery confirmed with you after you order</li><li>Questions about fit? <a href="/#contact">Chat with us</a></li></ul>
      </div>
    </div>`;

    let qty = 1;
    root.querySelectorAll('.detail-actions [data-step]').forEach((b) => b.addEventListener('click', () => {
      qty = Math.max(1, Math.min(qty + Number(b.dataset.step), Math.max(p.stock, 1), 20));
      root.querySelector('#detail-qty').textContent = qty;
    }));
    root.querySelectorAll('.gallery-thumbs button').forEach((b) => b.addEventListener('click', () => {
      root.querySelector('.gallery-visual').src = b.dataset.src;
      root.querySelectorAll('.gallery-thumbs button').forEach((t) => t.classList.toggle('active', t === b));
    }));
    root.querySelector('#add-to-bag').addEventListener('click', () => {
      const size = root.querySelector('input[name="size"]:checked')?.value || '';
      const error = root.querySelector('#size-error');
      if (p.sizes.length && !size) { error.hidden = false; return; }
      error.hidden = true;
      cart.add(p, size, qty);
      openBag();
    });
    root.querySelectorAll('input[name="size"]').forEach((r) => r.addEventListener('change', () => { root.querySelector('#size-error').hidden = true; }));
  }).catch(notFound);
})();

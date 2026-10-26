import './env.js';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { db, UPLOAD_DIR, getSettings, saveSettings, serializeProduct } from './db.js';
import { passwordMatches, createSession, destroySession, isAdmin, requireAdmin } from './auth.js';

const PORT = Number(process.env.PORT) || 3000;
const SECURE_COOKIES = process.env.NODE_ENV === 'production';
const ORDER_STATUSES = ['awaiting_payment', 'confirmed', 'fulfilled', 'cancelled'];

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠  ADMIN_PASSWORD is not set — the admin panel will refuse all sign-ins. Add it to .env.');
}

const app = express();
app.disable('x-powered-by');
// Dokploy terminates HTTPS at Traefik; honour its forwarded scheme for share URLs.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function inTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const slugify = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-|-$/g, '') || 'product';

function uniqueSlug(base, ignoreId = 0) {
  let slug = slugify(base);
  let n = 1;
  while (db.prepare('SELECT 1 FROM products WHERE slug = ? AND id != ?').get(slug, ignoreId)) slug = `${slugify(base)}-${++n}`;
  return slug;
}

function entityId(value, label = 'Product') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, `Invalid ${label.toLowerCase()} ID.`);
  return id;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new HttpError(400, 'Boolean fields must be true or false.');
}

// Accepts "45", "45.5", "1,200.00" → integer cents. Empty → null.
function toCents(value, field, { optional = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') {
    if (optional) return null;
    throw new HttpError(400, `${field} is required.`);
  }
  const num = Number(String(value).replace(/[,\s]/g, ''));
  if (!Number.isFinite(num) || num < 0) throw new HttpError(400, `${field} must be a positive number.`);
  const cents = Math.round(num * 100);
  if (!Number.isSafeInteger(cents)) throw new HttpError(400, `${field} is too large.`);
  return cents;
}

const isHexColor = (v) => /^#[0-9a-f]{3,8}$/i.test(String(v || ''));

function productFields(body, existing = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Product details are required.');
  const name = String(body.name ?? existing.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Product name is required.');
  if (name.length > 160) throw new HttpError(400, 'Product name must be 160 characters or fewer.');
  let stock = Number(body.stock ?? existing.stock ?? 0);
  if (!Number.isSafeInteger(stock) || stock < 0) throw new HttpError(400, 'Stock must be a whole number, 0 or more.');
  const compareAtInput = Object.hasOwn(body, 'compareAt') ? body.compareAt : (existing.compare_at_cents == null ? '' : existing.compare_at_cents / 100);
  const priceInput = Object.hasOwn(body, 'price') ? body.price : (existing.price_cents == null ? '' : existing.price_cents / 100);
  const compareAt = toCents(compareAtInput, 'Compare-at price', { optional: true });
  const price = toCents(priceInput, 'Price');
  const sizesInput = Object.hasOwn(body, 'sizes') ? body.sizes : (existing.sizes || '');
  const sizes = (Array.isArray(sizesInput) ? sizesInput : String(sizesInput).split(','))
    .map((s) => String(s).trim()).filter(Boolean);
  if (sizes.length > 30 || sizes.some((s) => s.length > 30)) throw new HttpError(400, 'Use up to 30 size options, each 30 characters or fewer.');
  const variantInput = Object.hasOwn(body, 'stockBySize') ? body.stockBySize : (existing.variant_stock || '{}');
  let stockBySize = {};
  if (variantInput && typeof variantInput === 'object' && !Array.isArray(variantInput)) stockBySize = variantInput;
  else if (String(variantInput || '').trim()) {
    const source = String(variantInput).trim();
    if (source.startsWith('{')) {
      try { stockBySize = JSON.parse(source); } catch { throw new HttpError(400, 'Stock by size must be valid JSON or use “Size: quantity” rows.'); }
    } else {
      for (const line of source.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)) {
        const splitAt = line.lastIndexOf(':');
        if (splitAt < 1) throw new HttpError(400, 'Stock by size must use “Size: quantity” rows.');
        stockBySize[line.slice(0, splitAt).trim()] = line.slice(splitAt + 1).trim();
      }
    }
  }
  if (!stockBySize || typeof stockBySize !== 'object' || Array.isArray(stockBySize)) throw new HttpError(400, 'Stock by size must be a size-to-quantity map.');
  const entries = Object.entries(stockBySize);
  if (entries.length) {
    const normalized = {};
    for (const [size, value] of entries) {
      const key = String(size).trim();
      const quantity = typeof value === 'number' ? value : (/^\d+$/.test(String(value).trim()) ? Number(value) : Number.NaN);
      if (!sizes.includes(key)) throw new HttpError(400, `Stock option “${key}” is not in the size list.`);
      if (!Number.isSafeInteger(quantity) || quantity < 0) throw new HttpError(400, `Stock for “${key}” must be a whole number, 0 or more.`);
      normalized[key] = quantity;
    }
    if (sizes.some((size) => !Object.hasOwn(normalized, size))) throw new HttpError(400, 'Enter stock for every size or clear the stock-by-size field to use total stock.');
    stockBySize = normalized;
    stock = Object.values(stockBySize).reduce((total, quantity) => total + quantity, 0);
    if (!Number.isSafeInteger(stock)) throw new HttpError(400, 'Total stock is too large.');
  }
  const description = String(body.description ?? existing.description ?? '').trim();
  if (description.length > 5000) throw new HttpError(400, 'Description must be 5,000 characters or fewer.');
  const badge = String(body.badge ?? existing.badge ?? '').trim();
  if (badge.length > 30) throw new HttpError(400, 'Badge must be 30 characters or fewer.');
  const category = slugify(String(body.category ?? '').trim() || existing.category || 'clothing');
  if (category.length > 60) throw new HttpError(400, 'Category must be 60 characters or fewer.');
  return {
    name,
    description,
    category,
    price_cents: price,
    compare_at_cents: compareAt && compareAt > price ? compareAt : null,
    sizes: sizes.join(', '),
    variant_stock: JSON.stringify(stockBySize),
    stock,
    badge,
    featured: Number(asBoolean(body.featured, Boolean(existing.featured))),
    published: Number(asBoolean(body.published, existing.published === undefined ? true : Boolean(existing.published))),
    background: isHexColor(body.background ?? existing.background) ? (body.background ?? existing.background) : '#e9edf5',
    accent: isHexColor(body.accent ?? existing.accent) ? (body.accent ?? existing.accent) : '#355fac'
  };
}

const getProductRow = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else { field += char; if (char === '\n') line++; }
    } else if (char === '"') {
      if (field) throw new HttpError(400, `Invalid CSV quoting near line ${line}.`);
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push({ values: row, line: rowLine });
      row = []; field = ''; line++ ; rowLine = line;
    } else field += char;
  }
  if (quoted) throw new HttpError(400, `Unclosed quoted field starting before line ${rowLine}.`);
  if (field || row.length || (text && !/[\r\n]$/.test(text))) { row.push(field); rows.push({ values: row, line: rowLine }); }
  return rows;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const PRODUCT_CSV_COLUMNS = ['slug', 'name', 'description', 'category', 'price', 'compareAt', 'sizes', 'stockBySize', 'stock', 'badge', 'featured', 'published', 'background', 'accent'];

function createProduct(f, slug) {
  const result = db.prepare(`INSERT INTO products (slug, name, description, category, price_cents, compare_at_cents, sizes, variant_stock, stock, badge, featured, published, background, accent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slug, f.name, f.description, f.category, f.price_cents, f.compare_at_cents, f.sizes, f.variant_stock, f.stock, f.badge, f.featured, f.published, f.background, f.accent);
  return Number(result.lastInsertRowid);
}

function updateProduct(id, f, slug, reason = 'Product update') {
  const previous = db.prepare('SELECT stock, variant_stock FROM products WHERE id = ?').get(id);
  db.prepare(`UPDATE products SET slug = ?, name = ?, description = ?, category = ?, price_cents = ?, compare_at_cents = ?, sizes = ?, variant_stock = ?, stock = ?, badge = ?,
    featured = ?, published = ?, background = ?, accent = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(slug, f.name, f.description, f.category, f.price_cents, f.compare_at_cents, f.sizes, f.variant_stock, f.stock, f.badge, f.featured, f.published, f.background, f.accent, id);
  if (previous && (previous.stock !== f.stock || previous.variant_stock !== f.variant_stock)) {
    const auditReason = previous.stock === f.stock && previous.variant_stock !== f.variant_stock ? 'Per-size stock updated' : reason;
    db.prepare('INSERT INTO stock_adjustments (product_id, previous_stock, new_stock, reason) VALUES (?, ?, ?, ?)')
      .run(id, previous.stock, f.stock, auditReason.slice(0, 120));
  }
}

function publicSettings() {
  const { currency, phone, whatsapp, email, address, instagram, facebook, announcement } = getSettings();
  return { currency, phone, whatsapp, email, address, instagram, facebook, announcement };
}

// ---------- storefront API ----------

app.get('/api/settings', (req, res) => res.json(publicSettings()));

app.get('/api/products', (req, res) => {
  const where = ['published = 1'];
  const params = [];
  if (req.query.category) { where.push('category = ?'); params.push(String(req.query.category)); }
  if (req.query.featured) where.push('featured = 1');
  if (req.query.q) {
    where.push('(name LIKE ? OR description LIKE ? OR category LIKE ? OR badge LIKE ?)');
    const term = `%${String(req.query.q)}%`;
    params.push(term, term, term, term);
  }
  const rows = db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY (stock <= 0), featured DESC, created_at DESC, id DESC`).all(...params);
  res.json(rows.map(serializeProduct));
});

app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT category, COUNT(*) AS count FROM products WHERE published = 1 GROUP BY category ORDER BY category').all();
  res.json(rows);
});

app.get('/api/products/:slug', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Product not found.' });
  res.json(serializeProduct(row));
});

// Order request: prices and stock are re-checked here, never trusted from the browser.
// Payment is not taken yet — orders start as "awaiting_payment".
app.post('/api/orders', (req, res) => {
  const { customer = {}, items = [] } = req.body || {};
  const name = String(customer.name || '').trim();
  const phone = String(customer.phone || '').trim();
  if (!name || !phone) throw new HttpError(400, 'Please add your name and phone number.');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your bag is empty.');
  if (items.length > 50) throw new HttpError(400, 'Too many items in one order.');

  const lines = items.map((item) => {
    const row = db.prepare('SELECT * FROM products WHERE id = ? AND published = 1').get(Number(item.productId));
    if (!row) throw new HttpError(400, 'One of the items in your bag is no longer available.');
    const qty = Math.max(1, Math.min(20, Number.parseInt(item.qty, 10) || 1));
    if (row.stock < qty) throw new HttpError(400, `Sorry, only ${row.stock} of “${row.name}” left.`);
    const sizes = row.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const size = String(item.size || '');
    if (sizes.length && !sizes.includes(size)) throw new HttpError(400, `Please choose a size for “${row.name}”.`);
    let stockBySize = {};
    try { stockBySize = JSON.parse(row.variant_stock || '{}'); } catch {}
    if (size && Object.keys(stockBySize).length && Number(stockBySize[size] || 0) < qty) {
      throw new HttpError(400, `Sorry, only ${Number(stockBySize[size] || 0)} in size ${size} for “${row.name}”.`);
    }
    return { productId: row.id, name: row.name, slug: row.slug, size, qty, unitCents: row.price_cents, lineCents: row.price_cents * qty };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineCents, 0);
  const reference = `NB-${Date.now().toString(36).toUpperCase().slice(-5)}${randomBytes(2).toString('hex').toUpperCase()}`;
  const { currency } = getSettings();
  db.prepare(`INSERT INTO orders (reference, customer_name, customer_phone, customer_email, fulfilment, address, notes, items_json, subtotal_cents, currency)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(reference, name, phone, String(customer.email || '').trim(), customer.fulfilment === 'collection' ? 'collection' : 'delivery',
      String(customer.address || '').trim(), String(customer.notes || '').trim().slice(0, 1000), JSON.stringify(lines), subtotal, currency);

  res.status(201).json({ reference, subtotalCents: subtotal, currency, items: lines });
});

// ---------- admin API ----------

const loginAttempts = new Map();
app.post('/api/admin/login', (req, res) => {
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
  if (attempt.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  if (!passwordMatches(req.body?.password || '')) {
    attempt.count += 1;
    if (attempt.count >= 5) { attempt.until = Date.now() + 5 * 60e3; attempt.count = 0; }
    loginAttempts.set(key, attempt);
    throw new HttpError(401, 'That password is not right.');
  }
  loginAttempts.delete(key);
  createSession(res, SECURE_COOKIES);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ signedIn: isAdmin(req) }));

app.use('/api/admin', requireAdmin);

app.get('/api/admin/stats', (req, res) => {
  const products = db.prepare('SELECT COUNT(*) AS total, SUM(published) AS live, SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) AS soldOut FROM products').get();
  const orders = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END) AS awaiting, COALESCE(MAX(id), 0) AS latestId FROM orders").get();
  res.json({ products: { total: products.total, live: products.live || 0, soldOut: products.soldOut || 0 }, orders: { total: orders.total, awaiting: orders.awaiting || 0, latestId: orders.latestId } });
});

app.get('/api/admin/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC, id DESC').all().map(serializeProduct));
});

app.get('/api/admin/categories', (req, res) => {
  res.json(db.prepare('SELECT category, COUNT(*) AS products FROM products GROUP BY category ORDER BY category').all());
});

app.patch('/api/admin/categories/:category', (req, res) => {
  const current = String(req.params.category || '');
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 60) throw new HttpError(400, 'Category name must be 1 to 60 characters.');
  const category = slugify(name);
  if (category === current) return res.json({ category, products: db.prepare('SELECT COUNT(*) AS count FROM products WHERE category = ?').get(category).count });
  if (db.prepare('SELECT 1 FROM products WHERE category = ?').get(category)) throw new HttpError(409, 'That category already exists.');
  const result = db.prepare('UPDATE products SET category = ?, updated_at = datetime(\'now\') WHERE category = ?').run(category, current);
  if (!result.changes) throw new HttpError(404, 'Category not found.');
  res.json({ category, products: result.changes });
});

app.patch('/api/admin/products/:id/stock', (req, res) => {
  const product = getProductRow(entityId(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found.');
  let currentBySize = {};
  try { currentBySize = JSON.parse(product.variant_stock || '{}'); } catch {}
  if (Object.keys(currentBySize).length) throw new HttpError(400, 'This product tracks stock by size. Update quantities in the product editor.');
  const stock = Number(req.body?.stock);
  if (!Number.isSafeInteger(stock) || stock < 0) throw new HttpError(400, 'Stock must be a whole number, 0 or more.');
  const reason = String(req.body?.reason || '').trim().slice(0, 120);
  inTransaction(() => {
    db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(stock, product.id);
    db.prepare('INSERT INTO stock_adjustments (product_id, previous_stock, new_stock, reason) VALUES (?, ?, ?, ?)')
      .run(product.id, product.stock, stock, reason);
  });
  res.json({ product: serializeProduct(getProductRow(product.id)), previousStock: product.stock, stock });
});

app.get('/api/admin/products/:id/stock-history', (req, res) => {
  const id = entityId(req.params.id);
  if (!getProductRow(id)) throw new HttpError(404, 'Product not found.');
  res.json(db.prepare('SELECT previous_stock AS previousStock, new_stock AS newStock, reason, created_at AS createdAt FROM stock_adjustments WHERE product_id = ? ORDER BY id DESC LIMIT 50').all(id));
});

app.get('/api/admin/products/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at DESC, id DESC').all();
  const lines = [PRODUCT_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    const product = serializeProduct(row);
    const values = {
      ...product,
      price: (product.priceCents / 100).toFixed(2),
      compareAt: product.compareAtCents == null ? '' : (product.compareAtCents / 100).toFixed(2),
      sizes: product.sizes.join(', '),
      stockBySize: JSON.stringify(product.stockBySize),
      featured: product.featured,
      published: product.published
    };
    lines.push(PRODUCT_CSV_COLUMNS.map((column) => csvCell(values[column])).join(','));
  }
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="nuburn-products.csv"').send(`\uFEFF${lines.join('\r\n')}\r\n`);
});

app.post('/api/admin/products/import', express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) throw new HttpError(400, 'Choose a CSV file with product rows.');
  const rows = parseCsv(req.body.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new HttpError(400, 'The CSV must include a header and at least one product row.');
  const headers = rows[0].values.map((value) => value.trim().toLowerCase());
  const normalized = headers.map((header) => ({ compareat: 'compareAt', stockbysize: 'stockBySize' })[header] || header);
  const allowed = new Set(PRODUCT_CSV_COLUMNS);
  const unknown = normalized.filter((header) => !allowed.has(header));
  if (unknown.length) throw new HttpError(400, `Unknown CSV column: ${unknown[0]}. Download the export first to get the supported columns.`);
  if (new Set(normalized).size !== normalized.length) throw new HttpError(400, 'The CSV has duplicate column names.');
  if (!normalized.includes('name') || !normalized.includes('price')) throw new HttpError(400, 'CSV columns “name” and “price” are required.');

  const errors = [];
  const batchSlugs = new Set();
  const items = [];
  for (const record of rows.slice(1)) {
    if (record.values.every((value) => !value.trim())) continue;
    if (record.values.length > normalized.length) { errors.push(`Line ${record.line}: too many values for the CSV columns.`); continue; }
    const body = Object.fromEntries(normalized.map((header, index) => [header, record.values[index] ?? '']));
    const slug = slugify(body.slug || body.name || 'product');
    if (batchSlugs.has(slug)) { errors.push(`Line ${record.line}: “${slug}” appears more than once.`); continue; }
    batchSlugs.add(slug);
    const existing = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
    try { items.push({ line: record.line, slug, existing, fields: productFields(body, existing || {}) }); }
    catch (error) { errors.push(`Line ${record.line}: ${error.message}`); }
  }
  if (!items.length && !errors.length) throw new HttpError(400, 'The CSV contains no product rows.');
  if (errors.length) throw new HttpError(400, `Import was not applied. ${errors.slice(0, 20).join(' ')}`);
  if (items.length > 500) throw new HttpError(400, 'Import up to 500 products at a time.');

  let created = 0, updated = 0;
  inTransaction(() => {
    for (const item of items) {
      if (item.existing) {
        updateProduct(item.existing.id, item.fields, item.existing.slug, 'CSV import');
        updated++;
      } else {
        createProduct(item.fields, uniqueSlug(item.slug));
        created++;
      }
    }
  });
  res.json({ created, updated, total: items.length });
});

app.get('/api/admin/products/:id', (req, res) => {
  const row = getProductRow(entityId(req.params.id));
  if (!row) throw new HttpError(404, 'Product not found.');
  res.json(serializeProduct(row));
});

app.post('/api/admin/products', (req, res) => {
  const f = productFields(req.body);
  const id = createProduct(f, uniqueSlug(f.name));
  res.status(201).json(serializeProduct(getProductRow(id)));
});

app.put('/api/admin/products/:id', (req, res) => {
  const existing = getProductRow(entityId(req.params.id));
  if (!existing) throw new HttpError(404, 'Product not found.');
  const f = productFields(req.body, existing);
  const slug = f.name === existing.name ? existing.slug : uniqueSlug(f.name, existing.id);
  updateProduct(existing.id, f, slug);
  res.json(serializeProduct(getProductRow(existing.id)));
});

app.delete('/api/admin/products/:id', async (req, res) => {
  const id = entityId(req.params.id);
  const images = db.prepare('SELECT filename FROM product_images WHERE product_id = ?').all(id);
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!result.changes) throw new HttpError(404, 'Product not found.');
  await Promise.all(images.map((img) => unlink(path.join(UPLOAD_DIR, img.filename)).catch(() => {})));
  res.json({ ok: true });
});

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${IMAGE_TYPES[file.mimetype]}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_TYPES[file.mimetype]) return cb(new HttpError(400, 'Images must be JPG, PNG, WebP, GIF or AVIF.'));
    cb(null, true);
  }
});

app.post('/api/admin/products/:id/images', (req, res, next) => {
  if (!getProductRow(entityId(req.params.id))) throw new HttpError(404, 'Product not found.');
  next();
}, upload.array('images', 10), (req, res) => {
  const product = getProductRow(entityId(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found.');
  let { pos } = db.prepare('SELECT COALESCE(MAX(position), -1) AS pos FROM product_images WHERE product_id = ?').get(product.id);
  const insert = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');
  for (const file of req.files || []) insert.run(product.id, file.filename, ++pos);
  res.json(serializeProduct(product));
});

// Body: { order: [imageId, ...] } — first one becomes the cover image.
app.put('/api/admin/products/:id/images/order', (req, res) => {
  const product = getProductRow(entityId(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found.');
  const current = db.prepare('SELECT id FROM product_images WHERE product_id = ? ORDER BY position, id').all(product.id).map((img) => img.id);
  const order = req.body?.order;
  if (!Array.isArray(order) || order.length !== current.length) throw new HttpError(400, 'Photo order must include every product photo.');
  const normalized = order.map((id) => Number(id));
  if (normalized.some((id) => !Number.isSafeInteger(id)) || new Set(normalized).size !== current.length || normalized.some((id) => !current.includes(id))) {
    throw new HttpError(400, 'Photo order contains an invalid or duplicate photo.');
  }
  const stmt = db.prepare('UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?');
  inTransaction(() => normalized.forEach((imageId, index) => stmt.run(index, imageId, product.id)));
  res.json(serializeProduct(product));
});

app.delete('/api/admin/images/:id', async (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(req.params.id);
  if (!img) throw new HttpError(404, 'Image not found.');
  db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  await unlink(path.join(UPLOAD_DIR, img.filename)).catch(() => {});
  res.json(serializeProduct(getProductRow(img.product_id)));
});

app.get('/api/admin/orders', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 500').all();
  res.json(rows.map((o) => ({ ...o, items: JSON.parse(o.items_json), items_json: undefined })));
});

app.patch('/api/admin/orders/:id', (req, res) => {
  const status = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Unknown order status.');
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/settings', (req, res) => res.json(getSettings()));
app.put('/api/admin/settings', (req, res) => {
  const body = { ...req.body };
  if (body.currency) body.currency = String(body.currency).trim().toUpperCase().slice(0, 3);
  res.json(saveSettings(body));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------- storefront pages ----------
// Storefront pages share one header and footer (server/partials) and get
// their <title>, description and link-preview (Open Graph) tags filled in here.

const PUBLIC_DIR = path.resolve('public');
const PARTIALS_DIR = path.resolve('server/partials');
const CACHE_PAGES = process.env.NODE_ENV === 'production';
const fileCache = new Map();
const readText = (file) => {
  if (!CACHE_PAGES || !fileCache.has(file)) fileCache.set(file, readFileSync(file, 'utf8'));
  return fileCache.get(file);
};
const escapeAttr = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatMoney(cents, currency) {
  const amount = (Number(cents) || 0) / 100;
  const digits = Number(cents) % 100 === 0 ? 0 : 2;
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); }
  catch { return `${currency} ${amount.toFixed(digits)}`; }
}

const siteUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function metaTags(req, { title, description, image, type = 'website', price }) {
  const base = siteUrl(req);
  const url = base + req.originalUrl;
  const tags = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    `<meta property="og:site_name" content="Nuburn Designs">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:url" content="${escapeAttr(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ];
  if (image) tags.push(`<meta property="og:image" content="${escapeAttr(base + image)}">`);
  if (price) tags.push(`<meta property="product:price:amount" content="${(price.cents / 100).toFixed(2)}">`, `<meta property="product:price:currency" content="${escapeAttr(price.currency)}">`);
  return tags.join('\n  ');
}

function renderPage(req, res, page, meta, status = 200) {
  const html = readText(path.join(PUBLIC_DIR, `${page}.html`))
    .replace('<!-- @meta -->', metaTags(req, meta))
    .replace('<!-- @header -->', readText(path.join(PARTIALS_DIR, 'header.html')))
    .replace('<!-- @footer -->', readText(path.join(PARTIALS_DIR, 'footer.html')));
  res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
}

const HOME_DESCRIPTION = 'Nuburn Designs brings together expressive clothing and footwear for everyday style and every occasion.';

app.get(['/', '/index.html'], (req, res) => renderPage(req, res, 'index', {
  title: 'Nuburn Designs — Style That Speaks', description: HOME_DESCRIPTION, image: '/images/hero.jpg'
}));

app.get(['/story', '/story.html'], (req, res) => renderPage(req, res, 'story', {
  title: 'Our story — Nuburn Designs',
  description: 'Discover the mission, vision and values behind Nuburn Designs clothing and footwear.',
  image: '/images/story.jpg'
}));

app.get(['/product', '/product.html'], (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE slug = ? AND published = 1').get(String(req.query.slug || ''));
  if (!row) return renderPage(req, res, 'product', { title: 'Not found — Nuburn Designs', description: HOME_DESCRIPTION }, 404);
  const product = serializeProduct(row);
  const { currency } = getSettings();
  const price = formatMoney(product.priceCents, currency);
  const summary = product.description.replace(/\s+/g, ' ').trim().slice(0, 140);
  renderPage(req, res, 'product', {
    title: `${product.name} — ${price} | Nuburn Designs`,
    description: `${price} · ${product.availability}${summary ? ` · ${summary}` : ''}`,
    image: product.images[0]?.url || '/images/hero.jpg',
    type: 'product',
    price: { cents: product.priceCents, currency }
  });
});

app.get(['/checkout', '/checkout.html'], (req, res) => renderPage(req, res, 'checkout', {
  title: 'Your bag — Nuburn Designs', description: HOME_DESCRIPTION
}));

// ---------- static files ----------

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.resolve('public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) err = new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be under 8 MB.' : err.message);
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  if (req.path.startsWith('/api')) return res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
  res.status(status).send(status === 404 ? 'Not found' : 'Something went wrong');
});

app.listen(PORT, () => console.log(`Nuburn store running → http://localhost:${PORT}  (admin: /admin)`));

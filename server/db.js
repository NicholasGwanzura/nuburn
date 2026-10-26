import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'clothing',
    price_cents INTEGER NOT NULL DEFAULT 0,
    compare_at_cents INTEGER,
    sizes TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0,
    badge TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    background TEXT NOT NULL DEFAULT '#ded7c8',
    accent TEXT NOT NULL DEFAULT '#bd5a3b',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL DEFAULT '',
    fulfilment TEXT NOT NULL DEFAULT 'delivery',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL,
    subtotal_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'awaiting_payment',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  instagram: '',
  facebook: '',
  announcement: ''
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export function saveSettings(values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in values) stmt.run(key, String(values[key] ?? '').trim());
  }
  return getSettings();
}

const imagesFor = db.prepare('SELECT id, filename, position FROM product_images WHERE product_id = ? ORDER BY position, id');

// Shape a product row for the API: booleans, image URLs, size list and availability text.
export function serializeProduct(row) {
  if (!row) return null;
  const images = imagesFor.all(row.id).map((img) => ({ id: img.id, url: `/uploads/${img.filename}` }));
  const stock = Number(row.stock);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    compareAtCents: row.compare_at_cents,
    sizes: row.sizes.split(',').map((s) => s.trim()).filter(Boolean),
    stock,
    availability: stock <= 0 ? 'Sold out' : stock <= 3 ? `Only ${stock} left` : 'In stock',
    badge: row.badge,
    featured: Boolean(row.featured),
    published: Boolean(row.published),
    background: row.background,
    accent: row.accent,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Adds a few sample products so you can see the store working. Delete them from /admin when you add real stock.
import '../server/env.js';
import { db } from '../server/db.js';

const demo = [
  ['Rust Linen Shirt', 'clothing', 4500, null, 'S, M, L, XL', 12, 'NEW ARRIVAL', '#e3d3bd', '#bd5a3b', 1],
  ['Olive Utility Jacket', 'clothing', 8900, 11000, 'M, L, XL', 4, '', '#d7d4c4', '#74784f', 0],
  ['Cream Wide-Leg Trousers', 'clothing', 5200, null, 'XS, S, M, L', 2, '', '#ece3d3', '#a07a5a', 0],
  ['Everyday Leather Sneaker', 'footwear', 7500, null, '38, 39, 40, 41, 42, 43', 9, 'BESTSELLER', '#d9b89e', '#1b1b19', 1],
  ['Terracotta Block Heel', 'footwear', 6800, null, '36, 37, 38, 39, 40', 0, '', '#e6d9c5', '#a74a30', 0]
];
const insert = db.prepare(`INSERT OR IGNORE INTO products (slug, name, description, category, price_cents, compare_at_cents, sizes, stock, badge, background, accent, featured)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
for (const [name, category, price, compare, sizes, stock, badge, bg, accent, featured] of demo) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  insert.run(slug, name, `Sample product — replace with your own description.\n\nA versatile ${category === 'footwear' ? 'pair' : 'piece'} for everyday style.`, category, price, compare, sizes, stock, badge, bg, accent, featured);
}
console.log(`Demo products added (${demo.length}).`);

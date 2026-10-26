# AGENTS.md: Nuburn Designs store handover

This is the context file for coding agents (Codex etc.) working on this repo. Read it before making changes.

## What this is

Online store for **Nuburn Designs**, a clothing and footwear brand. Customers browse products, add them to a bag and send an **order request**. **No payments yet**: orders are saved as `awaiting_payment` and the owner confirms payment and delivery manually. The owner manages products, photos, orders and settings in an admin panel at `/admin`.

## Stack

- **Node.js ≥ 22.13**, ES modules, **Express 5**, **Multer 2** (uploads)
- **SQLite via built-in `node:sqlite`** (no native deps, no ORM). DB file: `data/store.db`
- **Frontend:** plain HTML + CSS + vanilla JS. **No framework, no build step, no bundler.** Keep it that way unless asked.

## Run

```sh
npm install
npm run dev          # http://localhost:3000, admin at /admin (auto-restarts on server changes)
npm run seed:demo    # optional sample products
```

The admin password is `ADMIN_PASSWORD` in `.env` (see `.env.example`). Never commit `.env` or `data/`.

## Layout

```
server/
  env.js          loads .env (must be imported first)
  db.js           schema, settings, serializeProduct()
  auth.js         admin password + cookie sessions
  index.js        all routes, page rendering (partials + meta tags), static serving
  partials/       header.html + footer.html, shared by every storefront page
public/           storefront (served as-is)
  index.html      home: hero, categories, catalog, ordering, contact
  story.html      Our story: brand background, mission, vision and values
  product.html    product detail (?slug=)
  checkout.html   bag review + order request form
  favicon.svg
  store.js        SHARED on every page: api(), money(), cart, bag drawer, contact links, nav
  site.js         home catalog (search/filters)
  product.js      product page logic
  checkout.js     checkout logic
  styles.css      all storefront styles (design tokens at top)
  images/         site imagery slots (see "Images" below)
  admin/          admin panel (index.html, admin.js, admin.css)
scripts/seed-demo.js
data/             store.db + uploads/ (gitignored, the live catalogue: never delete)
```

## API (summary)

Public: `GET /api/settings`, `GET /api/products?q=&category=&featured=`, `GET /api/products/:slug`, `GET /api/categories`, `POST /api/orders`.
Admin (cookie session): `/api/admin/login|logout|me|stats`, CRUD `/api/admin/products`, CSV `GET /api/admin/products/export.csv` and `POST /api/admin/products/import`, category list/rename `/api/admin/categories`, stock update `/api/admin/products/:id/stock` and history `/api/admin/products/:id/stock-history`, `POST /api/admin/products/:id/images` (multipart `images`), `PUT /api/admin/products/:id/images/order`, `DELETE /api/admin/images/:id`, `GET/PATCH /api/admin/orders`, `GET/PUT /api/admin/settings`.

Money is stored as **integer cents** (`price_cents`). The API returns `priceCents` / `compareAtCents`; the frontend formats them with `Nuburn.money()` using the currency set in admin Settings.

## Design system (keep consistent)

- **Background is white everywhere** (`--bg:#fff`). This is an explicit owner requirement. Colour comes from blue accent blocks, image tiles and photos.
- **Logo:** `public/images/nuburn-logo.svg` is the supplied Nuburn Designs artwork. Use it in the shared header, footer and admin. Its blue (`#355fac`) is the site accent; keep the original paths intact.
- **Fonts:** `DM Sans` (UI/body, `--sans`) and `DM Serif Display` (`--serif`), loaded from Google Fonts in each page `<head>`. Headline pattern: sans 500 with tight tracking, plus an *italic serif accent word* in blue via `<em>`, e.g. `Style that <em>speaks.</em>`
- **Colours:** use the CSS variables at the top of `public/styles.css` (`--ink`, `--muted`, `--accent`, `--accent-dark`, `--accent-soft`, `--surface`, `--line`…). Don't hard-code new colours.
- **Readability floor:** no text below 11px; body copy 15–18px.
- **Shapes:** restrained 6px buttons and filters, 10–12px image tiles and content cards, thin `--line` dividers.
- **Breakpoints:** 1080 / 900 / 720px. Check mobile (≈390px) for every change.
- Admin uses its own `public/admin/admin.css` (same fonts and white theme).

## Images (current task for Codex)

Brief, filenames, sizes and prompts: **[public/images/README.md](public/images/README.md)**.

How the slots work: `index.html` contains `<img class="slot-img" src="/images/<name>.jpg" onerror="this.remove()">` inside the hero, the 3 category tiles, the new-arrivals panel and the story panel. If the file exists it covers the tile (and CSS `:has(.slot-img)` switches overlay text to white with a gradient); if not, the image removes itself and the original illustration shows. **So just save files with the exact names into `public/images/`.** No code change is needed.

Required files: `hero.jpg`, `category-clothing.jpg`, `category-footwear.jpg`, `category-new.jpg`, `new-arrivals.jpg`, `story.jpg`. Keep each under ~400 KB.

Product photos are **not** files in the repo; the owner uploads them per product in `/admin` (stored in `data/uploads/`).

## Conventions and gotchas

- **Header and footer live in `server/partials/` only.** Pages contain `<!-- @header -->`, `<!-- @footer -->` and `<!-- @meta -->` markers that the server fills in (see `renderPage` in `server/index.js`). Don't paste header/footer markup into page files, and don't add `<title>`/description tags to them: `metaTags()` generates title, description, favicon and Open Graph tags (product pages get name, price and photo for WhatsApp/Instagram link previews). Set `PUBLIC_URL` in production so preview image URLs are absolute and correct. Keep mission, vision and values on `/story` so the homepage leads with shopping.
- Catalog links work from any page: `/?category=clothing#catalog`, `/?category=new#catalog` (8 newest products), `/?q=search`. On the home page `site.js` applies them in place.
- Prices are formatted with `Intl.NumberFormat('en', { currencyDisplay: 'narrowSymbol' })` and no decimals for whole amounts ("$75", "$45.50"), in `store.js`, `admin.js` and `formatMoney()` on the server. Keep all three consistent.
- The admin resizes photos in the browser before upload (`shrinkImage` in `admin.js`, max 1600px JPEG) and polls for new orders every 45s (badge, tab title, optional browser notification).
- Behaviour hooks via data attributes (keep them when editing markup):
  - `data-open-bag` opens the bag drawer
  - `data-cart-count` shows the live bag count
  - `data-category-link="clothing|footwear|all"` sets the catalog filter on the home page
  - `data-contact="phone|whatsapp|email|address|instagram|facebook"` gets its link filled from admin Settings; a `[data-value]` child receives the text, `data-hide-empty` hides it if unset, and `data-keep-label` keeps the link text
  - `data-contact-group` hides a whole block when none of its `data-contact` items are set
  - `#whatsapp-link` (contact banner) falls back to email, then phone, then stays hidden
  - `#announcement` is filled from the Settings announcement field
- Always escape user and admin content with `escapeHtml` / `esc` before putting it into HTML strings.
- **The server is the source of truth for prices and stock.** `POST /api/orders` re-reads products and ignores client prices. Keep it that way.
- Product images: only jpg/png/webp/gif/avif, ≤ 8 MB, ≤ 10 per upload.
- Stock is **not** auto-decremented on order (no payment yet). The owner adjusts it manually. Products can use total stock or a per-size stock map; order requests validate the selected size when that map is set.
- Don't put contact details or prices in HTML. They come from the DB and Settings.

## Roadmap / next steps

1. **Images:** generate and add the 6 site images (above).
2. **Payments** (planned): in `POST /api/orders`, after saving, create a payment session (Stripe / Paynow / PayPal) for `subtotal_cents`; redirect from `public/checkout.js`; add a webhook that sets the order to `confirmed` and decrements stock.
3. **Hosting:** needs a Node host with a persistent disk (Render, Railway, Fly.io, VPS). Set `ADMIN_PASSWORD`, `NODE_ENV=production`, and `DATA_DIR` to the persistent volume.

## Before you finish a change

- Run `node --check` on edited JS files and load `/`, `/product?slug=<any>`, `/checkout` and `/admin/`. Make sure no `<!-- @… -->` marker is left in the served HTML.
- Check desktop and mobile widths, and that the background is still white.

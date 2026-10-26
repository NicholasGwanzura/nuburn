# Nuburn Designs online store

Storefront + product admin for Nuburn Designs. Node.js (Express) with a built-in SQLite database — no external database to set up.

## Run it

Requires Node.js 22.13 or newer.

```sh
npm install
npm start            # http://localhost:3000   (admin: http://localhost:3000/admin)
npm run dev          # same, restarts on file changes
npm run seed:demo    # optional: adds 5 sample products to try things out
```

The admin password lives in `.env` (`ADMIN_PASSWORD`). Copy `.env.example` to `.env` on a new machine and set your own.

## What's where

- `server/index.js` — API routes: storefront, orders, and admin (products, photo uploads, orders, settings)
- `server/db.js` — SQLite schema and settings
- `server/auth.js` — admin password check and sessions
- `public/` — storefront pages (`index.html`, `product.html`, `checkout.html`), styles and scripts
- `public/admin/` — admin panel
- `data/` — `store.db` and uploaded photos (`data/uploads`). **Back this folder up**; it is your catalogue.

## Admin

- **Products** — name, price, optional compare-at (sale) price, category, sizes, stock, badge, description, card colours, draft/published, featured. Upload multiple photos; the first is the cover, and arrows reorder them.
- **Orders** — order requests from checkout, with customer contact and items. Set status: awaiting payment → confirmed → fulfilled (or cancelled). Stock is not deducted automatically; adjust it on the product when you confirm a sale.
- **Settings** — currency code, announcement bar, phone/WhatsApp/email/address/social links shown on the site.

## Adding payments later

Checkout currently creates an order with status `awaiting_payment` and takes no money. To add payments (e.g. Stripe, Paynow, PayPal):

1. In `POST /api/orders` (`server/index.js`), after the order is saved, create a payment session for `subtotal_cents` and return its URL.
2. Redirect to it from `public/checkout.js` instead of showing the confirmation.
3. Add a webhook route that marks the order `confirmed` and deducts stock when payment succeeds.

Prices are always recalculated on the server, so the amount charged can't be tampered with from the browser.

## Hosting

This needs a Node server with persistent storage (the old static-only hosting in `.openai/hosting.json` cannot run the backend or store uploads).

### Dokploy

The repository includes a Dockerfile for Dokploy. Create an **Application** service from the repository and select **Dockerfile** as the build type, using `/` as the build path. The container listens on port `3000`.

Attach a named volume at `/app/data`. The image sets `DATA_DIR=/app/data` and `NODE_ENV=production`; this keeps the SQLite database and uploaded product photos across redeploys. Add `ADMIN_PASSWORD` as a secret environment variable in Dokploy before the first deployment. Set `PUBLIC_URL` to the final HTTPS domain when one is configured; it is used for product link previews.

Do not deploy with `.env` or `data/` copied into the image. `.dockerignore` excludes both. Keep a separate backup of the persistent data volume.

For other hosts, set `ADMIN_PASSWORD`, `NODE_ENV=production` (secure cookies, HTTPS required), `PUBLIC_URL` (for example, `https://nuburn.co.zw`), and point `DATA_DIR` at the host's persistent disk.

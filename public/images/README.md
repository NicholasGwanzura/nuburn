# Site images

Drop image files into this folder using the **exact filenames** below. Each one appears on the site automatically; until a file exists, the current illustration shows in its place. No code changes are needed.

Product photos are separate: upload those per product in the admin panel (`/admin`).

## Shared style (use in every prompt)

> Editorial fashion photography for a contemporary clothing and footwear brand. Warm, natural daylight, soft shadows, clean minimal set. Palette of warm neutrals (cream, sand, terracotta/rust, olive, black). Modern, confident, aspirational but approachable. No text, no logos, no watermarks.

## Files

| Filename | Where it shows | Size (px) | Ratio |
|---|---|---|---|
| `hero.jpg` | Large image beside the "Style that speaks" headline | 1600 × 2000 | 4:5 portrait |
| `category-clothing.jpg` | "Clothing" category tile | 1200 × 1400 | ~6:7 portrait |
| `category-footwear.jpg` | "Shoes & footwear" category tile | 1200 × 1400 | ~6:7 portrait |
| `category-new.jpg` | "New arrivals" category tile | 1200 × 1400 | ~6:7 portrait |
| `new-arrivals.jpg` | "Meet your next favourite" section | 2000 × 1600 | 5:4 landscape |
| `story.jpg` | "Wear what moves you" / about section | 1200 × 1500 | 4:5 portrait |

Text sits on top of the category tiles (top-left label, bottom-left title) and on the hero (small captions in the corners). Keep those areas fairly calm; the site adds a soft dark gradient for legibility.

## Prompts

**hero.jpg**: Full-length portrait of a stylish model in a relaxed rust/terracotta linen outfit with black trousers and minimal leather shoes, standing against a warm sand-coloured studio backdrop. Confident pose, subject centred, space above the head. 4:5 portrait.

**category-clothing.jpg**: A curated rail or flat-lay of folded and hanging garments (linen shirts, knitwear, wide-leg trousers) in cream, olive and rust tones on a light neutral background. Main subject in the middle, calm top and bottom edges. Portrait.

**category-footwear.jpg**: A still life of two or three pairs of shoes (leather sneakers, block heels, loafers) on stone plinths with soft daylight shadows, warm sand background. Calm top and bottom edges. Portrait.

**category-new.jpg**: A close-up of a model's styled outfit in a fresh olive-green tone with gold accessories, cropped at the torso, soft olive background. Calm top and bottom edges. Portrait.

**new-arrivals.jpg**: A lifestyle shot of two friends walking through a sunlit city street in coordinated neutral and rust outfits, mid-stride, natural and candid. 5:4 landscape.

**story.jpg**: Behind the scenes in a small fashion studio: hands adjusting a garment on a mannequin, fabric swatches and a tape measure on a wooden table, warm window light. Portrait.

## Tips

- Save as **JPG** (or keep the name and use `.jpg` even when it's a WebP export). Aim for **under 400 KB** each; compress with Squoosh or TinyPNG.
- Want a different filename or format? Change the `src="/images/…"` in `public/index.html`.

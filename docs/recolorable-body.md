# Recolorable car body — baking the layers

> This bakes the layers of the **[Layer contract](./layer-contract.md)** — see it
> for the formal `@unstable` published surface (named layers, registration, the
> 3/4 camera, the 1024×687 anchor, and the named overlay nodes).

The hero can recolour a single car render to **any paint colour** instead of
needing one PNG per colour. This is optional and advanced: if you just want a
fixed image, set `image:` and skip all of this.

This guide bakes the four layers the card composites. You only do it once per
vehicle render.

> **You bring your own render.** No vehicle artwork ships with this card. Use an
> image you have the right to use; keep it for your personal install; don't
> redistribute Tesla's designs or badges (they're trade dress / trademarks). A
> generic EV silhouette is the safe choice for anything public.

## The layer model

The card draws the `color` image as-is, then **inside the `mask`** it stacks:

```
color  ───────────────  base pixels: glass, wheels, lights, ground shadow
└ mask (white = body)   everything below is confined to the paint region:
    paint               your chosen colour (a flat fill)
    shade  × multiply    grayscale form — keeps the body's light/shadow on any colour
    highlight × screen   clearcoat glints — stay near-white on any colour (optional)
```

Two blend facts drive how you author the layers:

- **`multiply`** only *darkens*: `result = paint × shade`. Where `shade` is
  white the paint shows at full strength; where it's mid-grey the paint is
  darkened ~50%; black → black. So `shade` is a **grayscale of the body's
  form/lighting**. (Paint hexes are chosen a touch bright on purpose, because
  the shade then darkens them toward the real colour.)
- **`screen`** only *lightens*: `result = 1 − (1−base)(1−highlight)`. Black adds
  nothing; white forces white. So `highlight` is **black everywhere except the
  specular glints**.

All per-vehicle geometry lives in the **mask** — the renderer never hard-codes a
coordinate, which is why one generic component handles any vehicle.

## What you need

- A source render of the vehicle, ideally:
  - on a **transparent** background,
  - reasonably high-res (≈1024px wide is plenty),
  - body in an **even, mid-tone** colour (a neutral grey render recolors best;
    a very dark or very saturated source fights the blends).
- [ImageMagick](https://imagemagick.org) (`magick`) for the mechanical steps.
- An image editor (GIMP / Photoshop / Affinity / Krita) for the **mask**, which
  needs a manual selection.

Below, the source is `render.png`. Keep every layer the **same pixel size**.

## 1. Mask — the one that matters

White = the paintable body, black = everything else. **Exclude** glass, black
trim, bumpers, wheels and lights — anything that should *not* take the body
colour.

In your editor: select the body panels, fill the selection white on a black
background, feather the edge 1–2px so the recolor doesn't alias, and export as
`mask.png` (same dimensions as the render). This is the only hand-made layer and
the biggest driver of quality — take your time on the selection.

## 2. Color — the base

The base shows through everywhere outside the mask, so it just needs correct
glass / wheels / lights / shadow. The original render usually works directly:

```bash
magick render.png -quality 92 color.webp
```

(Inside the mask this gets fully overpainted, so the body pixels here don't
matter.)

## 3. Shade — grayscale form (`multiply`)

Desaturate and spread the body's tones so the lightest body area is near white
(paint shows fully) and shadows stay dark:

```bash
magick render.png -alpha off -colorspace Gray -auto-level -quality 92 shade.webp
```

`-auto-level` normalises contrast across the image. If wheels/shadow throw the
levels off, isolate the body first (composite the mask as alpha, then level only
those pixels) — but start with the simple command and judge it in the demo.

## 4. Highlight — clearcoat glints (`screen`, optional)

Keep only the brightest specular and crush everything else to black:

```bash
magick render.png -alpha off -colorspace Gray \
  -black-threshold 78% -level 78%,100% -quality 92 highlight.webp
```

Raise the threshold for fewer/sharper glints, lower it for a glossier look. Omit
this layer entirely for a matte finish — the card treats `highlight` as optional.

## 5. Wire it up

> **Shipping a pack, or juggling more than one model?** See
> **[asset-packs.md](./asset-packs.md)** for per-model placement
> (`config/www/tesla-card/<model>/`), swapping models by URL, and the
> never-committed / `@unstable` rules. This section bakes one pack; that doc
> distributes and swaps them.

Put the four files where Home Assistant serves them (e.g.
`config/www/tesla-card/`) and reference them:

```yaml
type: custom:tesla-card
name: Model Y
paint: blue
body:
  color: /local/tesla-card/color.webp
  shade: /local/tesla-card/shade.webp
  highlight: /local/tesla-card/highlight.webp
  mask: /local/tesla-card/mask.png
  # If your layers aren't 1024×687, set the intrinsic size so the viewBox matches:
  # width: 1600
  # height: 900
  # Optional named NODES (see the Layer contract) — both default sensibly if omitted:
  # chargePort: { x: 180, y: 470 }   # charge-port glow anchor, in 1024×687 space
  # apertureLayers:                   # per-aperture neutral-silver inpainted overlays
  #   frunk: /local/tesla-card/aperture-frunk.webp
  #   liftgate: /local/tesla-card/aperture-liftgate.webp
  #   door: /local/tesla-card/aperture-door.webp
  #   window: /local/tesla-card/aperture-window.webp
```

See [README → Paint](../README.md#paint) for the colour forms (`paint` accepts a
literal CSS colour, a generic colour-preset name, or an entity source; vendor
marketing names are user-supplied via the source's `map`).

## 6. Verify locally

The demo harness can render your layers with no Home Assistant:

1. Drop the files into `demo/local/` named exactly `color.webp`, `shade.webp`,
   `highlight.webp`, `paintmask.png` (this folder is gitignored — your art stays
   out of the repo).
2. `npm run build && npm run demo`, then open the demo with, e.g.,
   `?recolor=1&paint=Deep%20Blue` — or sweep colours by changing `paint=`.

Tune `shade`/`highlight` and re-export until it reads right across a few very
different colours (white, black, red, blue). If white looks flat, your `shade`
needs more contrast; if dark colours lose all form, the `shade` mid-tones are
too light.

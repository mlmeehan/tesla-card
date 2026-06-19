# Asset packs — bring your own render & multiple models (`@unstable`)

> ⚠️ **`@unstable` — this is a one-way door.** Bring-your-own renders and
> multi-model asset packs are built on the **[Layer contract](./layer-contract.md)**,
> which is a published public surface but **not frozen**. It MAY change before it
> freezes; the public freeze is gated behind asset-pipeline productionization
> (architecture.md D6). If you author a pack against this shape, expect it to
> shift — **pin the card version you built against**. Your packs are user-owned
> and never committed to this repo, so a contract change only means re-baking.

The card ships **no vehicle artwork**. The zero-config hero is a deliberately
generic, inline EV silhouette that recolours to any [paint](../README.md#paint)
with no assets — so a fresh install always shows a clean car and **never 404s**.
This document is the **distribution / usage** layer: how to point the hero at
*your* render, how to swap a *different model's* pack, and how packs are baked to
WebP, served from Home Assistant, and **kept out of the card repo**.

Three docs, three lanes — this one links to the other two, it does not restate them:

- **[Layer contract](./layer-contract.md)** — the *formal shape* a conforming
  render must have (named layers/nodes, registration, the 3/4 camera, the
  1024×687 anchor, fall-through).
- **[Recolorable body](./recolorable-body.md)** — the *layer mechanics* (the
  multiply/screen blends and the `magick … .webp` bake commands per layer).
- **Asset packs** (this doc) — the *distribution/usage*: BYO flat-vs-body, WebP
  externalization + placement, multi-model swap, the never-committed boundary.

## Two ways to bring your own render

### 1. Flat image — the simplest

Point `image:` at a single flat render served by Home Assistant. It renders as a
plain `<img>`; **`paint` is ignored** in this mode (a flat image can't be tinted).

```yaml
type: custom:tesla-card
name: My Car
image: /local/tesla-card/my_car.png
```

### 2. Recolorable body pack — one asset set, every colour

Supply the **Layer-contract** layers and the hero composites + recolours them to
any `paint` — so one pack covers every colour instead of one PNG per colour. The
required layers are `color` / `shade` / `mask`; `highlight` and the named nodes
(`apertureLayers` / `chargePort`) are optional. See
[recolorable-body.md](./recolorable-body.md) for how the blends work and how to
bake each layer, and [layer-contract.md](./layer-contract.md) for the formal shape.

```yaml
type: custom:tesla-card
name: My Car
paint: blue                                 # or '#2a4f93', or an entity (see Paint)
body:
  color: /local/tesla-card/my-car/color.webp      # base: glass, wheels, lights, shadow
  shade: /local/tesla-card/my-car/shade.webp      # grayscale form, ×multiply
  highlight: /local/tesla-card/my-car/highlight.webp  # clearcoat glints, ×screen (optional)
  mask: /local/tesla-card/my-car/mask.png         # white = the paintable body region
```

## WebP externalization workflow

Photoreal / body-layer packs are **externalized to WebP and served by Home
Assistant** — they are referenced by URL via the Layer contract and **never
committed to the card repo**. The bundled generic EV stays inline either way
(the externalization boundary — architecture.md D6): only your bring-your-own
packs externalize; the zero-config default never does.

1. **Bake the layers to WebP.** Follow the per-layer `magick … .webp` commands in
   [recolorable-body.md](./recolorable-body.md#2-color--the-base) — don't fork
   them; that doc owns the bake recipe. WebP is the baked output format for
   `color` / `shade` / `highlight` (the `mask` is typically a PNG).
2. **Place them under your Home Assistant install**, one directory per pack:
   `config/www/tesla-card/<model>/color.webp`, `…/shade.webp`, `…/mask.png`, … .
   The `config/www/` tree is **your HA install**, not this repo — Home Assistant
   serves it at `/local/…`.
3. **Reference them via the Layer contract** in `config.body`, using the
   HA-served path: `/local/tesla-card/<model>/color.webp`, etc.

**Hard rules:**

- Packs are **HA-served, referenced via the contract, and NEVER committed to the
  card repo.** The repo gitignores personal art (`demo/local/`) and the
  trade-dress gate scans the committed tree — keep your packs in your HA install.
- The **generic EV stays bundled / inline**, so a fresh install never 404s — no
  `/local/...` fallback is ever assumed by the card.

## Multiple models — swapping is config-only

Because the contract hard-codes **no per-vehicle geometry** (the `mask` carries
it all — see [recolorable-body.md](./recolorable-body.md#the-layer-model)), the
*same* renderer draws *any* model whose pack conforms. So you keep **one pack
directory per model** and switch models by changing the `config.body` URLs —
**no card change, no model-specific code**:

```yaml
# Model A — a 1024×687 pack:
body:
  color: /local/tesla-card/model-a/color.webp
  shade: /local/tesla-card/model-a/shade.webp
  mask:  /local/tesla-card/model-a/mask.png
```

```yaml
# Model B — a different pack, different intrinsic size. Only the paths differ
# (plus width/height when the pack isn't 1024×687, so the viewBox matches):
body:
  color:  /local/tesla-card/model-b/color.webp
  shade:  /local/tesla-card/model-b/shade.webp
  mask:   /local/tesla-card/model-b/mask.png
  width:  1600
  height: 900
```

**Graceful degradation.** A swapped pack that is **missing a required layer**
(`color` / `shade` / `mask`) is non-conforming: the card does not render it,
**falls through** `body → image → bundled EV`, and logs one honest warning
naming the missing layer. A missing **optional** node (`highlight` /
`apertureLayers` / `chargePort`) simply doesn't render that cue — no warning, no
failure. (See the Layer contract's
[fall-through rule](./layer-contract.md#named-layers).)

## Bring renders you have the right to use

Use a render you have the right to use, keep it for your personal install, and
**don't redistribute Tesla's designs or badges** — vehicle designs are trade
dress and the badges/wordmark are trademarks. A generic EV silhouette is the safe
choice for anything public. No vehicle artwork ships with this card, and none
should be committed to it.

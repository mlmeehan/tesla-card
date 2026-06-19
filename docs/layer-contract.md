# The Layer contract (`@unstable`)

> ⚠️ **`@unstable` — this is a one-way door.** The Layer contract is a published
> public surface, but it is **not frozen**. It MAY change before it freezes; the
> public freeze is gated behind asset-pipeline productionization (architecture.md
> D6). If you author a bring-your-own render pack against this shape (Story 3.7),
> expect it to shift — pin the card version you built against.

The **Layer contract** defines what a *conforming body render* is: the set of
identically-sized, registration-aligned image layers (plus named overlay nodes)
that the hero composites and recolours. The bundled generic EV needs none of this
— it ships inline and recolours with zero assets. The contract governs the
**optional upgrade**: a photoreal / multi-model body pack you bring yourself.

Two halves, kept in agreement by a test:

- **Machine-checkable half** — `LAYER_CONTRACT` (`src/layer-contract.ts`), an
  `as const` map that names the layers, pins the viewBox, declares the camera and
  carries `unstable: true`. `layer-contract.test.ts` asserts its shape *and* that
  it agrees with the `BodyLayers` type, so the contract can't silently drift.
- **Human half** — this document.

## Named layers

A body render composites a `color` base, then **inside the `mask`** stacks the
paint, `shade` and optional `highlight` (see [recolorable-body.md](./recolorable-body.md)
for how the blends work and how to bake each layer):

| Layer        | Required | Blend      | What it is |
|--------------|----------|------------|------------|
| `color`      | ✅       | base       | Real pixels — glass, wheels, lights, ground shadow. Shows everywhere outside the mask. |
| `shade`      | ✅       | ×multiply  | Grayscale of the body's form/lighting — reproduces shape on any paint colour. |
| `highlight`  | optional | ×screen    | Clearcoat glints — stay near-white on any colour. Omit for a matte finish. |
| `mask`       | ✅       | (mask)     | White = the paintable body region; confines the recolor to the body. |

A body **missing any required layer** is *non-conforming*: the card does **not**
render it (that would produce a broken `<image>`). It **falls through** the
render-mode priority (`body → image → bundled EV`) and logs one honest warning
naming the missing layer. (`carView` / `isConformingBody`.)

## Named nodes

Overlay nodes are **not paint layers** — they anchor a cue. When omitted, the cue
simply doesn't render (graceful by construction); no node is ever required.

| Node             | What it is |
|------------------|------------|
| `apertureLayers` | Per-aperture (`frunk`/`liftgate`/`door`/`window`) neutral-silver inpainted overlay URLs. Each renders as a crossfading `<image class="ap ap-<name>">` layer **above** the recolor stack. |
| `chargePort`     | `{ x, y }` anchor (in 1024×687 space) for the charge-port glow + cable overlay, rendered **above** the apertures (topmost cue). Defaults to a sensible rear-quarter point when omitted. |

## Registration — identical size, alignment, one camera

Every layer **and** every overlay must share the **same canvas, the same car
position/scale, and the same camera & lens** (aperture-render-spec.md:17-20).
This is *registration*: the layers composite pixel-on-pixel, so a mask drawn for
`color` lines up with `shade`, and an aperture overlay lines up with the body
beneath it. Mis-registered layers composite wrong — a mask offset by a few pixels
bleeds paint onto glass; an aperture overlay drawn at a different scale floats.

- **Identical pixel size** across all layers/overlays.
- **3/4 camera** — a front-right three-quarter view (the reference render is
  `1024×687`, front-right 3/4, silver — aperture-render-spec.md:15).
- **Anchored to `HERO_VIEWBOX` (1024×687)** — the [Story 3.1 coordinate
  contract](./architecture.md) every hero render mode shares, and the space the
  `chargePort` anchor and aperture regions are measured in. If your layers are a
  different intrinsic size, set `body.width`/`body.height` so the viewBox matches.

## Externalization & bring-your-own packs

Body packs are **never bundled** — no vehicle artwork ships with the card. They
are WebP files **you** serve from Home Assistant (`config/www/tesla-card/…`,
referenced as `/local/tesla-card/…`), and they are **never committed to the card
repo**. This document defines the *shape* a conforming pack has; the
bring-your-own / multi-model **distribution & usage** how-to — externalizing to
WebP, placing packs under your HA install, swapping models by URL, and the
never-committed boundary — lives in **[asset-packs.md](./asset-packs.md)**. Keep
your packs to renders you have the right to use — a generic EV is the safe choice
for anything public (trade dress / trademarks).

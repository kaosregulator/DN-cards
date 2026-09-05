# /animate — the Noto motion-composition engine

A **new** command that adds to `/emoji` without touching it. Where `/emoji` turns
an image into an animated emoji through a style, `/animate` **re-composes real
movement** onto a target: it borrows the keyframed motion from Noto's animated
emoji (blink, yawn, nod, tears, …), adapts it to the target's *own* geometry, and
plays it back as a looping GIF — a few candidates to choose from.

```
Discord /animate
      ↓
  commands/            resolve target · defer · panel · gallery · post
      ↓
  planner/             prompt/gesture → ranked, explainable recipes
      ↓                (borrow eyes from one emoji, mouth from another…)
  engine/
    detect.ts          find the TARGET's own eyes/mouth/face (no GPU, any subject)
    warp-mesh.ts       2D mesh warp of the target's OWN pixels, localized
    compositor.ts      recipe + detected geometry → frames
    effects.ts         tears/sparkles/steam ANCHORED to detected features
    render.ts          queue + cache → GIF candidates
      ↓
  GIF (loops) → Discord
```

## The one rule: motion, not artwork

Only **motion** is borrowed from Noto. The renderer animates **the user's own
image** and never draws Noto pixels — the emoji itself moves. A Noto-derived
track is a set of normalized transform curves plus tags and provenance; the
overlays (tears, sparkles) are procedural vector shapes drawn here, not Noto art.

## Target-adaptive, not face-assuming

Custom emoji are photos, memes, animals, gems. So before any motion is applied,
`detect.ts` analyzes the target's own pixels (content box + dark-blob/symmetry
eye & mouth detection) and returns **target-relative** geometry. Motion anchors
to *that* — `eyes` motion drives the detected eyes; tears fall from them. When no
face is found, facial tracks are dropped and the whole object animates (bounce,
spin, effects) instead of faking a face. The detector sits behind a pluggable
`FeatureDetector` so a learned detector (MediaPipe FaceLandmarker / SAM, as
[avatar-graph-comfyui](https://github.com/avatechai/avatar-graph-comfyui) uses)
can replace it later without touching the compositor.

Use the **Debug** button (or `renderDebugOverlay` / `describeMapping`) to see
exactly what was detected and how a recipe maps onto it.

## Combinable, decomposed, intensity-scaled

A recipe is one optional track **per region** (`global`, `eyes`, `mouth`,
`brows`, `cheeks`) plus painted `effects`. Gesture presets (`library/gestures.ts`)
name, per region, the *tags* to look for — so `SIGH = eyes:slow-close +
mouth:exhale + head:drop` still borrows the actual movement from whatever emoji
matches best, and the user can swap any piece. One **intensity** dial (Subtle →
Normal → Dramatic → INSANE) scales every channel's amplitude and layers extra
supporting motion at the top end (cry → shaking → ugly-crying) from the same
library.

## The motion library

```
library/
  builtin-tracks.ts   hand-authored offline default — one good piece per region,
                      always present so /animate works with no network/data
  gestures.ts         named, decomposed gesture presets (+ escalations)
  tags.ts             name → canonical-tag vocabulary (shared with the harvester)
  motion-library.ts   loads data/noto-motion-library.json, MERGED over builtin
```

Harvest real Noto motion into `data/noto-motion-library.json`:

```bash
pnpm --filter @workspace/api-server run animate:harvest-noto -- --all
```

Each harvested track records Apache-2.0 provenance (source emoji name, glyph,
codepoint, URL). The file is optional — absent, the engine runs on builtin
tracks; present, harvested Noto motion is preferred.

## Caching

Identical requests skip rendering. The key is the SHA-256 of the target bytes
plus the recipe signature (track ids per region, effects, intensity) and the
size — so fifty people asking for 🐹 → sneeze at Normal cost one render.

## Future backends

`engine/renderer.ts` is a seam: the CPU canvas compositor is the default, but a
GPU / diffusion backend (Follow-Your-Emoji style) can implement the same
`renderFrames(image, recipe, size, features)` contract and be installed with
`setRenderer()` — the planner, cache, detector and command are unchanged.
```

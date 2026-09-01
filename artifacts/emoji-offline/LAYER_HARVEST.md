# MakeEmoji layer harvest — intent

## What you asked for

1. Use **https://makeemoji.com/** as the source of truth (Editor grid while scrolling).
2. Do **not** redraw / procedurally fake styles when the site already produces them.
3. Method: make a style on the site → download the result → remove the test subject → keep the **layer** → stamp the Discord user’s image into that slot.
4. That matches the old **/emojimoji green-screen** packs (PR #116–#118, #123/#126): green marks the hole; everything else is the animation chrome.
5. Settings (Speed / Direction / Size / Colour / Format / Quality) stay **controls**, not style tiles — even though names like `2x-wide-*` also appear as real style cards on the site.
6. New PR (previous #133 was merged).

## What the live site shows

- Header label: **~687 styles**.
- Scrolling the main Editor grid loads **~560–570** unique prerendered style previews (`assets.makeemoji.com/prerendered/default-cat-preview/{id}.*`).
- Gap vs 687 is mostly: disabled/premium cards, `super_animation:*` variants from rankings, and directional variants counted separately.
- Layout: ~48 cards between “Discover more” promo blocks (your “~44” read).

## Pipeline (this PR)

```
pnpm makeemoji:harvest-greenscreen   # upload solid #00FF00 → click style → save GIF/PNG
pnpm makeemoji:build-layers          # chroma-key green → layers/{id}/front.png + meta.json
```

Discord offline renderer **prefers layer packs** when present (`providers/offline/layer-pack.ts`).

## Past closed PRs (reference only — not re-landed)

| PR | Lesson |
| --- | --- |
| #116–#118 `/emojimoji` | Pack overlays + stamp scenes; green-screen was the reliable path |
| #123/#126 postmoji | Green-screen clip upload + chroma |
| #128 `/emoji` via MakeEmoji | Replaced emojimoji; discovery/manifest |
| #133 | Official CDN copy; removed SVG recreations — still not the green-slot workflow |

## Status

- Live catalog synced into `styles.json` / MakeEmoji manifest animation list.
- Seed layer packs harvested and building (continues with the same commands).
- Preview = final path uses the same layer compositor.

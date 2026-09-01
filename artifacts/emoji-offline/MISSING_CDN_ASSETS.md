# MakeEmoji official asset harvest — exceptions

Harvested at: 2026-09-01T02:26:44.651Z

## Rule

Only original free assets from `assets.makeemoji.com` / makeemoji.com are kept.
No SVG redraws, procedural GIFs, or approximated artwork.

## Prerendered

- OK: 473
- Missing: 0
- (none)

## Overlays

- OK: 37
- Missing: 0

## CDN frame sequences (`/frames/{style}/frame_XXXX.png`)

- OK: 87
- **Missing (do not invent replacements):** 16
- `banana-dance`
- `blankies`
- `blaze`
- `deal-with-it`
- `gigachad`
- `jammies`
- `laser-eyes`
- `nyan-cat`
- `party-blob`
- `party-parrot`
- `pepe-flag`
- `pet`
- `pokeball-almost`
- `pokeball-capture`
- `pokeball-go`
- `sad-blob`

## Procedural assets removed this run

- frames/pokeball-go/ (procedural SVG recreation deleted)
- frames/pokeball-capture/ (procedural SVG recreation deleted)
- frames/pokeball-almost/ (procedural SVG recreation deleted)

## Blocked offline composites

These styles have an official MakeEmoji prerendered GIF but **no** compositable CDN frame overlays.
Offline user-image rendering is blocked (`offlineReady: false`) rather than faking assets:

- `pokeball-go`
- `pokeball-capture`
- `pokeball-almost`

`pokeball-emerge` keeps official CDN frames.

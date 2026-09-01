# MakeEmoji offline library

Source of truth: [makeemoji.com](https://makeemoji.com/) free assets on `assets.makeemoji.com`.

- Styles in catalog: **473**
- Offline-compositable: **470**
- Official prerendered assets harvested: **473**
- Official overlays harvested: **37**
- Styles with official CDN frame sequences: **87**

## Blocked (missing compositable CDN frames — not recreated)

- `pokeball-almost` — official prerendered GIF kept at `assets/prerendered/pokeball-almost/default-cat.gif`; CDN `/frames/pokeball-almost/` is 404
- `pokeball-capture` — official prerendered GIF kept at `assets/prerendered/pokeball-capture/default-cat.gif`; CDN `/frames/pokeball-capture/` is 404
- `pokeball-go` — official prerendered GIF kept at `assets/prerendered/pokeball-go/default-cat.gif`; CDN `/frames/pokeball-go/` is 404

See `MISSING_CDN_ASSETS.md` for the full list of styles without CDN frame sequences (some still composite via archived MakeEmoji atlases/overlays).

## Fidelity counts

- `approximate-procedural`: 329
- `makeemoji-cdn-frames`: 87
- `makeemoji-overlay`: 37
- `approximate-composite`: 16
- `makeemoji-prerendered-gif-only`: 3
- `exact`: 1

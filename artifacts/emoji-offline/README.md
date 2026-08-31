# MakeEmoji offline backup

Archive of the verified MakeEmoji.com discovery used by DN Cards `/emoji`, plus a
**partial offline engine** that independently renders a growing subset of styles.

## Purpose

The offline engine is the **default** generator (473/473 styles). MakeEmoji.com
remains the discovery/source-of-truth for new styles; harvest with
`pnpm makeemoji:harvest-frames` / `pnpm makeemoji:backup`.

```text
default  →  offline provider (local, no browser)
opt-out  →  EMOJI_DISABLE_OFFLINE=1  (force MakeEmoji browser path)
```

## Coverage

**473 / 473 styles offline-ready** (`manifest.json` → `offlineReady: true`).

Families:

| Family | Approach |
| --- | --- |
| `passthrough` | Identity (`none`) — Colour alone can still animate the subject |
| `transform` | Shared motion/scale/color primitives |
| `overlay` | Subject composited into archived overlay hole |
| `atlas` / `frames` | Archived MakeEmoji CDN frames / sliced atlases |

### Colour side-control (MakeEmoji `#color-select`)

Matches the site’s Colour dropdown: recolors the upload **before** the style
runs. Animated modes (`Colors`, `Rainbow`, `Stripes`, `Circles`) produce a
looping GIF even with style `none`. Static looks (`Deep Fried`, `X-Ray`, tints,
…) apply a single filter. Speed/Direction continue to apply as before.

## Contents

| Path | What |
| --- | --- |
| `VERSION` | Backup package version |
| `manifest.json` | Offline package metadata |
| `styles.json` | Full discovered style registry |
| `controls.json` | Discovered controls |
| `recipes/` | Per-style recipes + classification |
| `assets/overlays/` | Archived static overlays for overlay-family styles |
| `renderer/mappings.json` | Ready style → primitive map |
| `checksums.json` | SHA-256 hashes |
| `makeemoji-offline-backup.zip` | Reproducible archive |

## Regenerating

```bash
pnpm makeemoji:backup
```

Preserves `recipes/` and `assets/` while refreshing discovery metadata + ZIP.

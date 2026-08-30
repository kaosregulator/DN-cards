# MakeEmoji offline backup

Archive of the verified MakeEmoji.com discovery used by DN Cards `/emoji`, plus a
**partial offline engine** that independently renders a growing subset of styles.

## Purpose

MakeEmoji.com is the **primary** generator today. This package preserves the full
discovered catalog and implements as many styles as practical offline via shared
procedural primitives + archived overlay assets.

```text
MakeEmoji available  →  makeemoji-browser (primary)
MakeEmoji unavailable →  offline provider (ONLY if EMOJI_ALLOW_OFFLINE_FALLBACK=1)
```

Offline fallback is **disabled by default**. Package-level `offlineReady` stays
`false` until 473/473 styles render independently.

## Coverage

See `manifest.json` → `implementedStyleCount` and `recipes/recipes.json`.

Families:

| Family | Approach |
| --- | --- |
| `passthrough` | Identity (`none`) |
| `transform` | Shared motion/scale/color primitives |
| `overlay` | Subject composited into archived overlay hole |
| `atlas` / `frames` | Pending — needs archived MakeEmoji frame assets |

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

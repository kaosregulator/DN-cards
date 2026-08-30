# Offline renderer notes

This directory records how archived MakeEmoji style IDs map onto the DN Cards
local procedural renderer for the **partial** offline proof-of-concept.

- Mappings are **exact name matches only** (e.g. discovered `shake` → local `shake`).
- Fidelity is approximate: MakeEmoji's client-side encoders are not reproduced.
- Styles without a mapping remain in `styles.json` as discovery metadata only.

When a real offline encoder for a style lands, add assets here and update
`mappings.json` + the style's `offlineImplemented` flag via `pnpm makeemoji:backup`.

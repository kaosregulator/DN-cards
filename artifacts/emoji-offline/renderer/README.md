# Offline renderer notes

Recipes in `../recipes/recipes.json` map each MakeEmoji style id to a **family**
and **primitive**. Only styles with `offlineReady: true` are independently
renderable.

- **transform** — shared procedural primitives (`shake`, `bounce`, `spin`, …)
- **overlay** — archived PNG/AVIF under `../assets/overlays/` + hole composite
- **passthrough** — `none`
- **atlas / frames** — not offline-ready until assets + placement land

Fidelity is approximate unless noted. MakeEmoji remains the primary provider.

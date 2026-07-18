---
name: Flubber + napi-rs canvas notes
description: Type setup and runtime capability for using Flubber path morphs with the napi-rs canvas renderer.
---

- `flubber` v0.4.2 ships without TypeScript declarations. Typecheck fails until a project declaration file is added (e.g. `artifacts/api-server/src/types/flubber.d.ts`). Inline `declare module` inside a `.ts` file is treated as an augmentation and fails for untyped modules, so use a `.d.ts` file instead.

- `@napi-rs/canvas` exposes `Path2D(pathString)` and context methods `clip(path)`, `fill(path)`, `stroke(path)`, so SVG path data from Flubber's interpolators can be rendered directly on the canvas. This project had no prior `Path2D` usage; prefer explicit `.d.ts` typings and a runtime fallback in case the canvas build does not include the class.

**Why:** The user requested Flubber morphs for canvas-based recycle animations; the package works once typed and can be paired with the napi-rs canvas, but the manual star-polygon fallback currently handles the visual morph without relying on SVG path parsing.

**How to apply:** When adding other JS packages without types, add a focused `.d.ts` in the artifact's `src/types` directory and only introduce `Path2D` usage after a runtime smoke test in the target environment.

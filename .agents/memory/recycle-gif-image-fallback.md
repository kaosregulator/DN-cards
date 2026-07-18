---
name: Recycle GIF timing & image fallback
description: Why the recycle morph animation can appear missing and how to handle card images that fail to load on the canvas.
---

- The recycle morph GIF was being replaced by the result screen almost immediately after it was posted. GIFs play client-side; if the bot edits the message right after the editReply, the GIF never has time to display. Always `await sleep(animationDurationMs)` after posting an animated GIF before editing the message again.

- Some card image URLs (e.g. `https://misu.nephbox.net/card_image/...`) return SVG/error content instead of a raster image. `@napi-rs/canvas` throws `Invalid SVG image` for these. The shared `loadArt` helper catches the error and returns `null`, so `drawCardArt` falls back to a dark placeholder. The animation still works; the card art just doesn't render. Do not treat the logged warning as a fatal failure unless the canvas itself returns null.

**Why:** The user reported "no animation/morphing" when recycling. The root cause was the missing delay between the GIF editReply and the result editReply. The image-load warnings are a separate, non-fatal issue with the external image service.

**How to apply:** For any future animated confirmation, always sleep for the animation duration before the final state update. When rendering canvas UIs, expect external image URLs to occasionally fail and ensure the renderer has a fallback path.

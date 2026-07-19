---
name: Canvas image load timeouts
description: Remote image loads for server-side canvas rendering can hang forever; always race them with a timeout so the renderer can fall back and the Discord interaction does not stay stuck.
---

`@napi-rs/canvas` `loadImage` and object-storage downloads can hang indefinitely on a slow, unreachable, or malformed URL. Because the renderer is wrapped in `queueRender`, one hanging load also blocks every other render job in the queue.

**Rule:** every image load used in canvas rendering must be wrapped in `Promise.race` with a hard timeout (default 10 seconds). On timeout, log and return `null`/skip the art so the rest of the command reply can still be sent.

**Why:** A Discord slash command that defers first but never edits leaves the user seeing "Bot is thinking…" forever. The bot's top-level error handler only catches thrown errors, not promises that never resolve.

**How to apply:** Wrap `mod.loadImage(url)` and `loadObjectStorageImage` calls in `effects.ts` and any direct `loadImage` calls in renderers (e.g., `recycle-generator.ts`) with a timeout helper. Cached promises should be the timeout-wrapped promise so repeated requests don't wait for the original hung load.
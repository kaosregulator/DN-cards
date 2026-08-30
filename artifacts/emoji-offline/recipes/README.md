# Offline style recipes

Each MakeEmoji style maps to a **recipe**: a family + primitive + params.

Families:
- `passthrough` — identity (e.g. `none`)
- `transform` — procedural motion/scale/color via shared primitives
- `overlay` — static overlay with subject in transparent hole
- `atlas` — animated atlas frames composited with the subject
- `frames` — numbered PNG frame sequences

`offlineReady` is true only when the offline engine can render that style
independently (assets present + compositor implemented + smoke-tested).

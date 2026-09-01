# MakeEmoji layer packs (Download All ZIP)

## Source
Official MakeEmoji **Download All as ZIP** after uploading a solid green subject and scrolling the full Editor grid.

- Drive original: `https://drive.google.com/file/d/1p3aDviKGx0Gux__U02n5FdgyW2yAlApe/view?usp=sharing`
- Local: `greenscreen/makeemoji-all-green.zip` (570 files)
- Built packs: `layers/{style}/front.png` + `meta.json`

## Discord substitution
Green pixels in each ZIP frame are the **animated subject slot**. `/emoji` resolves:

- member avatar
- your avatar
- server icon
- uploaded image

…and composites that image so it **inherits MakeEmoji’s per-frame green-subject animation** (position, scale, deformation, visibility, timing), then draws the keyed MakeEmoji chrome on top. This is not a static bounding-box stamp.

## Pack layout
Each `layers/{style}/` contains:

- `front.png` — vertical sprite sheet, green keyed out (foreground chrome)
- `slot.png` — vertical sprite sheet of the green-subject mask per frame
- `meta.json` — `perFrame[]` bbox/centroid/visibility/`delayMs`, plus `motionPx` / `areaRatio`

Builder: `artifacts/api-server/scripts/makeemoji-build-layers.mjs`  
Compositor: `animationMode: "per-frame-slot-mask"` in `layer-pack.ts`

## Count
**566** usable styles in the Discord catalog (4 ZIP entries had no clean chroma slot and were omitted: `bat-signal`, `bat-signal-scene`, `crying-laughing`, `rgb-split`).

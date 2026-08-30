# Discovery archive notes

Captured from the verified MakeEmoji discovery on the PR #128 branch.

- Site: https://makeemoji.com/
- Processing: client-side (blob GIF/WebP/PNG previews after upload)
- Generation API: none usable while logged out (`/api/images`, `/api/download` → 401)
- Integration: headless Chromium browser provider (`makeemoji-browser`)
- Style tiles: `data-tag="gen_btn_<name>"`
- Controls: custom listboxes `#speed-select`, `#direction-select`, `#size-select`,
  `#color-select`, `#format-select`, `#quality-select`

The full live provider manifest remains at:

`artifacts/api-server/src/bot/emoji/providers/makeemoji/manifest.json`

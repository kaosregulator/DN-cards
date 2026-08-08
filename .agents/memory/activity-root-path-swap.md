---
name: Activity root path swap
description: Activity owns `/` (Discord needs to load it from root); Dashboard moved to `/dashboard`; single Discord URL mapping pattern.
---

# Activity root path swap

## Rule
The Phaser Discord Activity artifact must be served at the root path `/` of the deployment domain. Discord's URL mapping always loads the Activity from `https://your-host.com/` — if the root serves anything else (e.g. the Dashboard), Discord loads the wrong HTML and the Activity never starts.

**Why:** Discord Developer Portal URL mappings only accept plain hostnames as targets (no path suffix). The `/` mapping entry is what Discord uses to locate the Activity's `index.html`. There is no way to point Discord at a sub-path like `dn-cards.replit.app/activity`.

## How to apply
- Activity artifact: `paths = ["/"]`, `previewPath = "/"`, `BASE_PATH = "/"`
- Dashboard artifact: `paths = ["/dashboard"]`, `previewPath = "/dashboard"`, `BASE_PATH = "/dashboard"`
- Activity `main.ts`: redirect non-Discord, non-demo visitors to `/dashboard` (preserving pathname for deep links)
- Bot `setup-link.ts`: setup URL must include `/dashboard` prefix → `${base}/dashboard/setup/${token}`
- Bot `welcome.ts` `dashboardAdminUrl()`: return `/dashboard/admin` not `/admin`

## Discord URL mapping (single entry)
Only one mapping should exist in the Developer Portal:

| Prefix | Target |
|--------|--------|
| `/` | `dn-cards.replit.app` |

**Do NOT add a `/api` mapping.** With a single `/` mapping, Discord strips only the leading `/` and forwards the full remaining path. So `/.proxy/api/activity/status` → strips `/` → sends `dn-cards.replit.app/api/activity/status`. A separate `/api` mapping would take precedence (longest prefix) and strip the `/api` prefix, causing all Activity API calls to 404.

## Asset URLs
The Activity client constructs sprite URLs as `${api.assetBase()}${manifest.base}/${rel}`:
- `api.assetBase()` = `/.proxy/api` (inside Discord)
- `manifest.base` = `/activity/assets/hq` (returned by `/api/activity/assets/manifest`)
- Full: `/.proxy/api/activity/assets/hq/sprite.png` → `dn-cards.replit.app/api/activity/assets/hq/sprite.png` ✅

No changes needed to `api.ts` or the manifest route for this to work correctly.

---
name: Activity preview base paths
description: The local Replit path-routed Activity preview and Discord production Activity use different URL roots.
---

The Activity's local development server is mounted under `/activity`, so Vite development output must use `/activity/` as its base for module and asset URLs. Discord's production URL mapping targets the Activity host at `/`, so production builds must continue emitting `/` URLs.

**Why:** Using one root-relative base for both environments makes the local preview load the wrong artifact or 404 its entry module, while using `/activity/` in production breaks Discord's root URL mapping.

**How to apply:** Make the Vite base conditional on the command/environment: use `/activity/` only for the path-routed dev server and `/` for production builds.
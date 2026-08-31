---
name: Playwright deployment browser cache
description: Deployment distinction between Chromium system libraries and the Playwright browser binary
---

Installing Chromium's Nix shared libraries does not install or package the Playwright-managed Chromium binary. A workspace cache can make local `ldd` and launch checks pass while the published VM still reports that no Chromium browser is installed.

**Why:** The published bot successfully started with the merged provider diagnostics, but provider discovery found no browser before launch; the workspace-only `.cache/ms-playwright` was not evidence that the deployment image contained the browser.

**How to apply:** Verify the browser binary exists in the actual published image or provide a valid deployment-visible `MAKEEMOJI_CHROMIUM_PATH`; validate provider discovery in production before diagnosing MakeEmoji page automation.
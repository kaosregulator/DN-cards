---
name: MakeEmoji browser runtime
description: Deployment requirements and failure modes for the MakeEmoji Playwright provider.
---

The MakeEmoji provider needs three independent runtime layers: the Playwright JavaScript package, the exact Chromium browser revision, and Linux shared libraries such as libgbm. Installing only one or two produces different startup failures.

**Why:** A deployment can include Playwright while still failing because its pinned browser is absent, or include the browser while Chromium exits before launch because the host loader cannot find libgbm.

**How to apply:** Verify the effective browser cache path, the pinned executable, and a real headless launch in the deployment environment; an HTTP 200 from MakeEmoji only proves outbound HTTPS, not browser readiness.
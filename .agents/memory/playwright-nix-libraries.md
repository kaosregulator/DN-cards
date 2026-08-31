---
name: Playwright Nix libraries
description: Nix runtime dependency split required by the MakeEmoji Playwright browser
---

For the MakeEmoji Playwright runtime, current nixpkgs requires both `libgbm` and `systemd` for Chromium's `libgbm.so.1` and `libudev.so.1`. The `mesa` package alone may expose Mesa drivers without the `libgbm.so.1` SONAME.

**Why:** Installing `mesa` resolved neither the complete Chromium dependency set nor the direct browser launch; `libudev.so.1` appeared only after `systemd`, and `libgbm.so.1` only after the separate `libgbm` attribute.

**How to apply:** When provisioning this bot's browser runtime, include `pkgs.libgbm` and `pkgs.systemd`, then verify both Chromium binaries with `ldd` and a real headless launch.
{pkgs}: {
  deps = [
    # ── headless Chromium (Playwright, used by /emoji) ────────────────────────
    # `ldd` on both the full Chromium and the headless shell reports exactly two
    # missing libraries on this image. Without them the browser aborts at start
    # with "error while loading shared libraries", which surfaces to users as
    # "The emoji generator couldn't start".
    #
    # Both use `or` fallbacks so a channel that names the package differently
    # degrades to the older provider instead of failing to evaluate and taking
    # the whole environment down with it.
    (pkgs.libgbm or pkgs.mesa)      # libgbm.so.1 — split out of mesa in newer nixpkgs
    (pkgs.udev or pkgs.systemd)     # libudev.so.1 — provided by systemd
    pkgs.libxkbcommon
    pkgs.expat
    pkgs.mesa
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.at-spi2-core
    pkgs.at-spi2-atk
    pkgs.alsa-lib
    pkgs.cairo
    pkgs.pango
    pkgs.gtk3
    pkgs.libdrm
    pkgs.cups
    pkgs.atk
    pkgs.dbus
    pkgs.nspr
    pkgs.nss
    pkgs.glib
  ];
}

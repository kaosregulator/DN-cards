{pkgs}: {
  deps = [
    # ── headless Chromium (Playwright, used by /emoji) ────────────────────────
    # `ldd` on both the full Chromium and the headless shell reports exactly two
    # missing libraries on this image. Without them the browser aborts at start
    # with "error while loading shared libraries", which surfaces to users as
    # "The emoji generator couldn't start".
    pkgs.libgbm      # libgbm.so.1  — mesa alone does not expose this SONAME here
    pkgs.systemd     # libudev.so.1
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

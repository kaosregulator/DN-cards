// ─────────────────────────────────────────────────────────────────────────────
// Offline asset helpers.
//
// Placeholder for future style-specific assets (sprite sheets, LUTs, WASM
// encoders). The partial offline path currently needs no external assets —
// it delegates to the local procedural renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { join } from "node:path";
import { offlinePackageRoot } from "./registry.js";

/** Absolute path to the offline assets directory, when the package is present. */
export function offlineAssetsDir(): string | null {
  const root = offlinePackageRoot();
  if (!root) return null;
  const dir = join(root, "assets");
  return existsSync(dir) ? dir : null;
}

/** Path to a named asset under the offline package, or null when missing. */
export function offlineAssetPath(name: string): string | null {
  const dir = offlineAssetsDir();
  if (!dir) return null;
  const path = join(dir, name);
  return existsSync(path) ? path : null;
}

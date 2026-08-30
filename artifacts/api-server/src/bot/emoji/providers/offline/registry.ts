// ─────────────────────────────────────────────────────────────────────────────
// Offline MakeEmoji style registry.
//
// Loads the archived discovery registry from artifacts/emoji-offline/. This is
// metadata for failover planning — only styles marked offlineImplemented are
// renderable today.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface OfflineStyle {
  id: string;
  name: string;
  tag: string;
  dataTag: string;
  category: string;
  offlineImplemented: boolean;
  offlineEffectId: string | null;
  source: string;
}

export interface OfflinePackageManifest {
  source: string;
  discoveredAt: string | null;
  styleCount: number;
  implementedStyleCount: number;
  version: string;
  offlineReady: boolean;
  primaryProvider: string;
  notes: string;
}

function candidateRoots(): string[] {
  const override = process.env["EMOJI_OFFLINE_PACKAGE_PATH"]?.trim();
  const here = fileURLToPath(new URL(".", import.meta.url));
  return [
    ...(override ? [override] : []),
    join(process.cwd(), "artifacts/emoji-offline"),
    join(process.cwd(), "../emoji-offline"),
    join(process.cwd(), "emoji-offline"),
    // providers/offline → artifacts/emoji-offline
    join(here, "../../../../../../emoji-offline"),
  ];
}

let cachedRoot: string | null | undefined;
let cachedStyles: OfflineStyle[] | undefined;
let cachedManifest: OfflinePackageManifest | null | undefined;

export function offlinePackageRoot(): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  for (const root of candidateRoots()) {
    if (existsSync(join(root, "styles.json")) && existsSync(join(root, "manifest.json"))) {
      cachedRoot = root;
      return root;
    }
  }
  cachedRoot = null;
  return null;
}

export function loadOfflineManifest(): OfflinePackageManifest | null {
  if (cachedManifest !== undefined) return cachedManifest;
  const root = offlinePackageRoot();
  if (!root) {
    cachedManifest = null;
    return null;
  }
  cachedManifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as OfflinePackageManifest;
  return cachedManifest;
}

export function loadOfflineStyles(): OfflineStyle[] {
  if (cachedStyles) return cachedStyles;
  const root = offlinePackageRoot();
  if (!root) {
    cachedStyles = [];
    return cachedStyles;
  }
  cachedStyles = JSON.parse(readFileSync(join(root, "styles.json"), "utf8")) as OfflineStyle[];
  return cachedStyles;
}

export function implementedOfflineStyles(): OfflineStyle[] {
  return loadOfflineStyles().filter(s => s.offlineImplemented && s.offlineEffectId);
}

export function findOfflineStyle(id: string): OfflineStyle | undefined {
  const needle = id.trim().toLowerCase().replace(/^gen_btn_/, "").replace(/^:|:$/g, "");
  return loadOfflineStyles().find(s =>
    s.id.toLowerCase() === needle ||
    s.tag.toLowerCase() === needle ||
    s.tag.toLowerCase() === `gen_btn_${needle}` ||
    s.name.toLowerCase() === needle,
  );
}

/** Test helper — drop caches so a rebuilt package is visible without restart. */
export function reloadOfflineRegistry(): void {
  cachedRoot = undefined;
  cachedStyles = undefined;
  cachedManifest = undefined;
}

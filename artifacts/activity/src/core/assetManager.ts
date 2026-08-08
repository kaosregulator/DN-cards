// ─────────────────────────────────────────────────────────────────────────────
// Asset Manager — resolves semantic sprite keys to real textures from the HQ art
// pack served by the backend, and lazy-loads them into Phaser on demand.
//
// Performance contract from the brief: we do NOT bulk-load the whole pack. A
// scene asks for the keys it needs; we load only those (deduped, cached), then
// resolve. Textures already in Phaser are reused across scenes.
// ─────────────────────────────────────────────────────────────────────────────

import type Phaser from "phaser";
import { api } from "../net/api";

export interface Manifest {
  base: string; // e.g. "/activity/assets/hq"
  sprites: Record<string, string>; // spriteKey → relative path
}

export class AssetManager {
  private manifest: Manifest | null = null;
  private readonly loaded = new Set<string>();

  async loadManifest(): Promise<void> {
    if (this.manifest) return;
    this.manifest = await api.assetManifest();
  }

  /** Does the pack know this sprite key? */
  has(key: string): boolean {
    return !!this.manifest?.sprites[key];
  }

  /** Absolute (proxy-relative) URL for a sprite key, or null if unknown. */
  urlFor(key: string): string | null {
    const rel = this.manifest?.sprites[key];
    if (!rel || !this.manifest) return null;
    return `${api.assetBase()}${this.manifest.base}/${rel}`;
  }

  /**
   * Ensure every given sprite key is loaded into Phaser, then resolve. The
   * texture key used inside Phaser IS the sprite key, so callers reference art
   * by its semantic name. Unknown keys are skipped (caller falls back).
   */
  async ensure(scene: Phaser.Scene, keys: string[]): Promise<void> {
    await this.loadManifest();
    const toLoad = keys.filter(
      (k) => this.has(k) && !this.loaded.has(k) && !scene.textures.exists(k),
    );
    if (toLoad.length === 0) return;

    for (const key of toLoad) {
      const url = this.urlFor(key);
      if (url) scene.load.image(key, url);
    }

    await new Promise<void>((resolve) => {
      scene.load.once("complete", () => resolve());
      scene.load.on("loaderror", () => {
        /* keep going — a missing texture just means that prop falls back */
      });
      scene.load.start();
    });

    for (const key of toLoad) {
      if (scene.textures.exists(key)) this.loaded.add(key);
    }
  }
}

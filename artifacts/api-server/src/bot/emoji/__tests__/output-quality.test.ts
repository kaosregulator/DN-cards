import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderOffline, loadOfflineStyles } from "../providers/offline/index.js";
import { buildServerModal, parseCid } from "../commands/ui.js";
import { imageFacts, testImage } from "./fixtures.js";

const DISCORD_EMOJI_LIMIT = 256 * 1024;

/** Opaque pixels touching the 1px border — the clip signal. */
async function edgeTouch(gif: Buffer): Promise<number> {
  const meta = await sharp(gif).metadata();
  const pages = meta.pages ?? 1;
  let worst = 0;
  for (let p = 0; p < pages; p++) {
    const { data, info } = await sharp(gif, { page: p, animated: false })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: ch } = info;
    let edge = 0;
    for (let x = 0; x < w; x++) {
      if (data[(0 * w + x) * ch + ch - 1]! > 40) edge++;
      if (data[((h - 1) * w + x) * ch + ch - 1]! > 40) edge++;
    }
    for (let y = 0; y < h; y++) {
      if (data[(y * w + 0) * ch + ch - 1]! > 40) edge++;
      if (data[(y * w + (w - 1)) * ch + ch - 1]! > 40) edge++;
    }
    worst = Math.max(worst, edge);
  }
  return worst;
}

describe("Discord-ready output", () => {
  // A spread across every rendering family — the ones most prone to clipping
  // (overlay/atlas/frames carry art on top of the subject).
  const all = () => loadOfflineStyles() as { tag?: string; dataTag?: string; offlineFamily?: string }[];
  const sample = () => {
    const styles = all();
    const pick = (fam: string, n: number) =>
      styles.filter(s => s.offlineFamily === fam).slice(0, n);
    return [...pick("overlay", 5), ...pick("atlas", 4), ...pick("frames", 4), ...pick("transform", 3)];
  };

  it("renders 128×128, under Discord's 256 KB limit, with nothing clipped", async () => {
    const image = await testImage(256);
    for (const style of sample()) {
      const tag = style.tag ?? style.dataTag!;
      const result = await renderOffline({ image, animation: tag, format: "gif", size: "128" });

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width, tag).toBe(128);
      expect(meta.height, tag).toBe(128);

      expect(result.bytes, `${tag} bytes`).toBeLessThan(DISCORD_EMOJI_LIMIT);

      // The user's gate: the final gif must not cut any overlay off. The safe
      // margin guarantees no opaque pixel reaches the border.
      expect(await edgeTouch(result.buffer), `${tag} clipped`).toBe(0);
    }
  }, 180_000);

  it("keeps a static PNG under the limit too", async () => {
    const result = await renderOffline({
      image: await testImage(256), animation: "gen_btn_shake", format: "png", size: "128",
    });
    const meta = await imageFacts(result.buffer);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(128);
    expect(result.bytes).toBeLessThan(DISCORD_EMOJI_LIMIT);
  }, 30_000);
});

describe("server-ID target", () => {
  it("offers a modal with an optional server-ID field", () => {
    const modal = buildServerModal("tok") as unknown as {
      data: { custom_id: string };
      components: { components: { data: { custom_id?: string; required?: boolean } }[] }[];
    };
    expect(parseCid(modal.data.custom_id)?.action).toBe("server_modal");
    const field = modal.components[0]!.components[0]!.data;
    expect(field.custom_id).toBe("server_id");
    // Optional: blank means "this server".
    expect(field.required).toBeFalsy();
  });
});

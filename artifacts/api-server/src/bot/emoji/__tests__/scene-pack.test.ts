/**
 * Scene packs — green/blue-screen clips composited on the user's image.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  loadScenes, sceneStyleEntries, sceneIdOf, isSceneAnimation, sceneLabelOf,
  renderScene, SCENE_PREFIX,
} from "../providers/offline/scene-pack.js";
import { renderOffline } from "../providers/offline/renderer.js";

/** A solid-colour square so we can spot the target inside the composite. */
async function solid(hex: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 4, background: { ...hex, alpha: 1 } } })
    .png().toBuffer();
}

describe("scene catalog", () => {
  it("loads the featured scenes with stable ids", () => {
    const scenes = loadScenes();
    expect(scenes).not.toBeNull();
    expect(scenes!.list.length).toBeGreaterThanOrEqual(20);
    // Featured order: Mission Passed leads.
    expect(sceneStyleEntries()[0]?.value).toBe(`${SCENE_PREFIX}mission-passed`);
  });

  it("recognises scene animation values", () => {
    expect(sceneIdOf("scene:mission-passed")).toBe("mission-passed");
    expect(isSceneAnimation("scene:cutting-board")).toBe(true);
    expect(isSceneAnimation("gen_btn_shake")).toBe(false);
    expect(sceneLabelOf("scene:theater")).toBe("Movie Theater");
    expect(sceneLabelOf("gen_btn_shake")).toBeNull();
  });
});

describe("scene compositor", () => {
  it("composites the target into the green screen and keeps the foreground", async () => {
    // Bright red target so we can find it; the source green must be gone.
    const buf = await renderScene(await solid({ r: 255, g: 0, b: 0 }), "mission-passed");
    expect(buf.subarray(0, 3).toString("ascii")).toBe("GIF");
    const meta = await sharp(buf, { animated: true }).metadata();
    expect((meta.pages ?? 1)).toBeGreaterThan(1);

    // Sample a mid frame: the target red should be present, and the pure MakeEmoji
    // green should be keyed out (no strong-green pixels left).
    const mid = Math.floor((meta.pages ?? 1) / 2);
    const { data } = await sharp(buf, { page: mid }).raw().toBuffer({ resolveWithObject: true });
    let red = 0, green = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      if (r > 180 && g < 90 && b < 90) red++;
      if (g > 150 && g - r > 80 && g - b > 80) green++;
    }
    expect(red).toBeGreaterThan(0);
    expect(green).toBe(0);
  }, 60_000);

  it("renders a smaller, fewer-framed preview for the board size", async () => {
    const full = await renderScene(await solid({ r: 0, g: 0, b: 255 }), "mission-passed");
    const thumb = await renderScene(await solid({ r: 0, g: 0, b: 255 }), "mission-passed", { size: 96 });
    const fm = await sharp(full, { animated: true }).metadata();
    const tm = await sharp(thumb, { animated: true }).metadata();
    expect((tm.width ?? 0)).toBeLessThan(fm.width ?? 0);
    expect(thumb.length).toBeLessThan(full.length);
  }, 60_000);

  it("routes scene ids through renderOffline as a GIF", async () => {
    const result = await renderOffline({
      image: await solid({ r: 0, g: 200, b: 0 }), animation: "scene:giant-portal", format: "gif",
    });
    expect(result.format).toBe("gif");
    expect(result.providerId).toBe("offline");
    expect(result.buffer.subarray(0, 3).toString("ascii")).toBe("GIF");
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { BEACH_CONCERT_ORIGIN } from "../src/world/beachConcert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dirname, "../public/world/beach-concert");

describe("beach concert scene assets", () => {
  it("anchors on the former music patio tiles", () => {
    expect(BEACH_CONCERT_ORIGIN).toEqual({ tx: 22, ty: 31 });
  });

  it("ships static stage props and animation sheets", () => {
    const required = [
      "static/21_Beach_32x32_Example_Big_Stage_1_Sand.png",
      "static/21_Beach_32x32_Example_Big_Stage_Structure.png",
      "static/21_Beach_32x32_Big_Loudspeaker_Sand.png",
      "static/21_Beach_32x32_Bamboo_Bar_Counter_2_Sand.png",
      "static/21_Beach_32x32_Stage_Barrier_1_Sand.png",
      "anim/dj.png",
      "anim/singer_1.png",
      "anim/singer_2.png",
      "anim/singer_3.png",
      "anim/laser_color.png",
      "anim/laser_color_2.png",
      "anim/fog_loop.png",
      "gifs/Beach_Concert_DJ_32x32.gif",
      "gifs/Beach_Concert_Laser_Machine_2_32x32.gif",
    ];
    for (const rel of required) {
      const p = join(PUBLIC, rel);
      expect(existsSync(p), rel).toBe(true);
      expect(readFileSync(p).byteLength).toBeGreaterThan(100);
    }
  });

  it("removed LimeZu music instrument tiles from world.tmj", () => {
    const tmj = JSON.parse(
      readFileSync(join(import.meta.dirname, "../public/world/maps/world.tmj"), "utf8"),
    );
    const MUSIC_FIRST = 3133;
    const MUSIC_LAST = 3596;
    let count = 0;
    const walk = (layers: any[]) => {
      for (const layer of layers) {
        if (layer.type === "group") walk(layer.layers ?? []);
        else if (layer.type === "tilelayer" && Array.isArray(layer.data)) {
          for (const gid of layer.data) {
            const raw = gid & 0x1fffffff;
            if (raw >= MUSIC_FIRST && raw <= MUSIC_LAST) count++;
          }
        }
      }
    };
    walk(tmj.layers);
    expect(count).toBe(0);
  });
});

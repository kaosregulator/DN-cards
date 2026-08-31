import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildControls, buildPostPicker, parseCid } from "../commands/ui.js";
import { setManifestForTesting } from "../providers/makeemoji/manifest.js";
import { Manifest } from "../providers/makeemoji/types.js";
import type { EmojiSession } from "../commands/session.js";

/** Discord's hard limits on message components. */
const MAX_ROWS = 5;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 25;

function liveManifest(): Manifest {
  const path = fileURLToPath(new URL("../providers/makeemoji/manifest.json", import.meta.url));
  return Manifest.parse(JSON.parse(readFileSync(path, "utf8"))) as Manifest;
}

function session(patch: Partial<EmojiSession> = {}): EmojiSession {
  return {
    image: Buffer.from([1]),
    ownerId: "u1",
    sourceLabel: "your avatar",
    animation: "gen_btn_shake",
    format: "gif",
    view: "controls",
    stylePage: 0,
    styleQuery: "",
    styleFilter: "all",
    styleFocus: null,
    expiresAt: Date.now() + 60_000,
    ...patch,
  } as EmojiSession;
}

describe("control panel component limits", () => {
  setManifestForTesting(liveManifest());
  afterAll(() => setManifestForTesting(null));

  // The panel is built from a 473-style manifest and sits exactly on Discord's
  // caps. Going one over is rejected at send time, which surfaces as the whole
  // command failing rather than as a layout bug.
  const rows = buildControls(session(), "tok") as unknown as {
    components: { data: { style?: number; options?: unknown[] } }[];
  }[];

  it("stays within the five-row limit", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("stays within five components per row", () => {
    for (const [i, row] of rows.entries()) {
      expect(row.components.length, `row ${i}`).toBeLessThanOrEqual(MAX_BUTTONS_PER_ROW);
      expect(row.components.length, `row ${i}`).toBeGreaterThan(0);
    }
  });

  it("never offers more than 25 options in a select", () => {
    for (const row of rows) {
      for (const component of row.components) {
        const options = component.data.options;
        if (Array.isArray(options)) {
          expect(options.length).toBeLessThanOrEqual(MAX_SELECT_OPTIONS);
        }
      }
    }
  });

  it("offers every image target and the post action", () => {
    const ids = rows.flatMap(r =>
      r.components.map(c => (c.data as { custom_id?: string }).custom_id ?? ""));
    for (const action of ["upload", "target_server", "target_me", "post", "done", "styles"]) {
      expect(ids.some(id => parseCid(id)?.action === action), action).toBe(true);
    }
  });

  it("disables Post until something has been generated", () => {
    const ids = (patch: Partial<EmojiSession>) =>
      (buildControls(session(patch), "tok") as unknown as {
        components: { data: { custom_id?: string; disabled?: boolean } }[];
      }[])
        .flatMap(r => r.components)
        .find(c => parseCid(c.data.custom_id ?? "")?.action === "post");

    expect(ids({})?.data.disabled).toBe(true);
    expect(ids({
      lastResult: {
        buffer: Buffer.from([1]), format: "gif", bytes: 10,
        providerId: "makeemoji-browser", cached: false,
      },
    })?.data.disabled).toBeFalsy();
  });
});

describe("post picker", () => {
  it("offers a channel select and a way back", () => {
    const picker = buildPostPicker(session({
      lastResult: {
        buffer: Buffer.from([1]), format: "gif", bytes: 2048,
        providerId: "makeemoji-browser", cached: false,
      },
    }), "tok");

    expect(picker.components.length).toBeLessThanOrEqual(MAX_ROWS);
    const ids = (picker.components as unknown as {
      components: { data: { custom_id?: string } }[];
    }[]).flatMap(r => r.components.map(c => c.data.custom_id ?? ""));

    expect(ids.some(id => parseCid(id)?.action === "post_pick")).toBe(true);
    expect(ids.some(id => parseCid(id)?.action === "post_back")).toBe(true);
    expect(picker.content).toContain("2.0 KB");
  });
});

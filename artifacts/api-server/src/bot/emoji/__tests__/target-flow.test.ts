import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildTargetChooser, parseCid } from "../commands/ui.js";
import { buildStylesPicker } from "../commands/styles-picker.js";
import { createSession, getSession, touchSession } from "../commands/session.js";
import { setManifestForTesting } from "../providers/makeemoji/manifest.js";
import { Manifest } from "../providers/makeemoji/types.js";
import { testImage } from "./fixtures.js";

function liveManifest(): Manifest {
  const path = fileURLToPath(new URL("../providers/makeemoji/manifest.json", import.meta.url));
  return Manifest.parse(JSON.parse(readFileSync(path, "utf8"))) as Manifest;
}

/** Flatten a component payload to the customId actions it contains. */
function actionsOf(payload: { components: unknown[] }): string[] {
  const rows = payload.components as { components: { data: { custom_id?: string } }[] }[];
  return rows.flatMap(r => r.components.map(c => parseCid(c.data.custom_id ?? "")?.action ?? ""));
}

describe("opening target chooser", () => {
  it("offers member / avatar / upload / server, all on ≤5 rows", () => {
    const chooser = buildTargetChooser("tok");
    const rows = chooser.components as unknown[];
    expect(rows.length).toBeLessThanOrEqual(5);

    const actions = actionsOf(chooser as { components: unknown[] });
    for (const a of ["pick_user", "pick_me", "upload", "pick_server"]) {
      expect(actions, a).toContain(a);
    }
  });

  it("uses a native member picker for User, not a plain button", () => {
    const chooser = buildTargetChooser("tok");
    const rows = chooser.components as { components: { data: { type?: number } }[] }[];
    // Discord component type 5 is the user-select menu.
    const hasUserSelect = rows.some(r => r.components.some(c => c.data.type === 5));
    expect(hasUserSelect).toBe(true);
  });
});

describe("target → style browser", () => {
  beforeAll(() => setManifestForTesting(liveManifest()));
  afterAll(() => setManifestForTesting(null));

  it("starts a session with no image on the target screen", () => {
    const { token, session } = createSession({
      image: null, ownerId: "u1", sourceLabel: null,
      animation: "gen_btn_shake", format: "gif", view: "target",
    });
    expect(session.view).toBe("target");
    expect(getSession(token)?.image).toBeNull();
  });

  it("renders the browser on the selected target once one is chosen", async () => {
    const { token } = createSession({
      image: null, ownerId: "u1", sourceLabel: null,
      animation: "gen_btn_shake", format: "gif", view: "target",
    });

    // Simulate a target pick: image loaded, view flips to the browser.
    const image = await testImage(128);
    const updated = touchSession(token, {
      image, sourceLabel: "Bob's avatar", view: "styles", styleFocus: "gen_btn_shake",
    })!;

    const picker = await buildStylesPicker(updated, token);
    // The board renders the page on the chosen target; the focused style's
    // animated preview rides alongside it. Both are real files rendered here —
    // not MakeEmoji's CDN cat.
    expect(picker.files.length).toBeGreaterThan(0);
    expect(picker.files.some(f => /style-board\.png$/.test(f.name ?? ""))).toBe(true);
    expect(picker.files.some(f => /\.gif$/.test(f.name ?? ""))).toBe(true);

    // The board dashboard sits exactly on Discord's five-row limit (jump select
    // + two number rows + nav + actions); one over is rejected at send time.
    const comps = picker.components as unknown as { components: unknown[] }[];
    expect(comps.length).toBeLessThanOrEqual(5);
    for (const [i, row] of comps.entries()) {
      expect(row.components.length, `row ${i}`).toBeGreaterThan(0);
      expect(row.components.length, `row ${i}`).toBeLessThanOrEqual(5);
    }
  }, 60_000);

  it("shows a different preview for a different target", async () => {
    const mk = async (img: Buffer) => {
      const { token } = createSession({
        image: img, ownerId: "u1", sourceLabel: "x", animation: "gen_btn_shake",
        format: "gif", view: "styles", styleFocus: "gen_btn_shake",
      });
      const picker = await buildStylesPicker(getSession(token)!, token);
      return picker.files[0]?.attachment as Buffer;
    };
    const a = await mk(await testImage(128));
    const b = await mk(await testImage(96));
    expect(Buffer.isBuffer(a) && Buffer.isBuffer(b)).toBe(true);
    // Different source image ⇒ different preview bytes: the previews really are
    // of the chosen target, not a shared placeholder.
    expect((a as Buffer).equals(b as Buffer)).toBe(false);
  }, 60_000);
});

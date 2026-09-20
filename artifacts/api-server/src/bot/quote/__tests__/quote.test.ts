import { describe, expect, it } from "vitest";
import { prepareQuoteText, stripDiscordMarkdown, wrapLines } from "../text.js";
import { QUOTE_STYLES, customFrom, getStyle } from "../styles.js";
import { DUAL_QUOTE_STYLES, getDualStyle } from "../dual-styles.js";

describe("quote text helpers", () => {
  it("strips common discord markdown", () => {
    expect(stripDiscordMarkdown("**bold** and *italic*")).toBe("bold and italic");
    expect(stripDiscordMarkdown("||spoiler||")).toBe("spoiler");
    expect(stripDiscordMarkdown("> quoted")).toBe("quoted");
  });

  it("resolves mentions when provided", () => {
    const out = prepareQuoteText("hey <@123> check <#456>", {
      users: [{ id: "123", username: "bob", displayName: "Bob" }],
      channels: [{ id: "456", name: "general" }],
    });
    expect(out).toContain("@Bob");
    expect(out).toContain("#general");
  });

  it("wraps long lines", () => {
    const ctx = {
      measureText: (t: string) => ({ width: t.length * 10 }),
    };
    const lines = wrapLines(ctx, "one two three four five", 50);
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("quote styles", () => {
  it("ships classic + discord + 4k + cinematic among presets", () => {
    expect(QUOTE_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(customFrom("classic").id).toBe("custom");
    expect(getStyle("classic").layout).toBe("classic");
    expect(getStyle("discord").layout).toBe("discord");
    expect(getStyle("caught4k").layout).toBe("caught4k");
    expect(getStyle("cinematic").layout).toBe("cinematic");
    expect(getStyle("absolute").layout).toBe("absolute");
    expect(getStyle("glitch").layout).toBe("glitch");
    expect(getStyle("bruhh").layout).toBe("bruhh");
    expect(getStyle("ethereal").layout).toBe("ethereal");
    expect(getStyle("miq").layout).toBe("fade-left");
  });
});

describe("dual quote styles", () => {
  it("ships classic set + vibe set (14 dual layouts)", () => {
    expect(DUAL_QUOTE_STYLES).toHaveLength(14);
    expect(getDualStyle("duo-classic").layout).toBe("duo-classic");
    expect(getDualStyle("duo-reaction").layout).toBe("duo-reaction");
    expect(getDualStyle("duo-thread").layout).toBe("duo-thread");
    expect(getDualStyle("duo-evidence").layout).toBe("duo-evidence");
    expect(getDualStyle("duo-notepad").layout).toBe("duo-notepad");
    expect(getDualStyle("duo-bubble").layout).toBe("duo-bubble");
    expect(getDualStyle("duo-terminal").layout).toBe("duo-terminal");
    expect(getDualStyle("duo-polaroid").layout).toBe("duo-polaroid");
    expect(getDualStyle("duo-sticky").layout).toBe("duo-sticky");
    expect(getDualStyle("duo-imessage").layout).toBe("duo-imessage");
    expect(getDualStyle("duo-newspaper").layout).toBe("duo-newspaper");
    expect(getDualStyle("duo-receipt").layout).toBe("duo-receipt");
    expect(getDualStyle("duo-chatlog").layout).toBe("duo-chatlog");
    expect(getDualStyle("duo-comic").layout).toBe("duo-comic");
  });
});

describe("dual slot hub", () => {
  it("maps dual-pick views to A/B slots", async () => {
    const { dualSlotFromView } = await import("../dual-ui.js");
    expect(dualSlotFromView({ view: "dual-pick-a" } as never)).toBe("a");
    expect(dualSlotFromView({ view: "dual-pick-b" } as never)).toBe("b");
    expect(dualSlotFromView({ view: "dual-builder" } as never)).toBe("a");
  });
});

import { describe, expect, it } from "vitest";
import { prepareQuoteText, stripDiscordMarkdown, wrapLines } from "../text.js";
import { QUOTE_STYLES, customFrom, getStyle } from "../styles.js";

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
  it("ships at least five presets plus custom", () => {
    expect(QUOTE_STYLES.length).toBeGreaterThanOrEqual(5);
    expect(customFrom("classic").id).toBe("custom");
    expect(getStyle("classic").avatarLayout).toBe("left");
    expect(getStyle("spotlight").avatarLayout).toBe("portrait");
  });
});

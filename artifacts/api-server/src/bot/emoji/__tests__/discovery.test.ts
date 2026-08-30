import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover } from "../providers/makeemoji/discovery/discover.js";
import { Manifest } from "../providers/makeemoji/types.js";
import { redactBody, redactHeaders, redactUrl } from "../providers/makeemoji/discovery/recorder.js";
import { mapControlToOption } from "../providers/makeemoji/discovery/inspect.js";
import { classifyProcessing } from "../providers/makeemoji/discovery/bundles.js";
import { startFixtureSite, type FixtureSite } from "./fixtures/server.js";
import { testImage } from "./fixtures.js";

describe("redaction", () => {
  it("removes credential headers but keeps their shape", () => {
    const out = redactHeaders({ cookie: "session=abc123", authorization: "Bearer xyz", accept: "*/*" });
    expect(out.cookie).not.toContain("abc123");
    expect(out.cookie).toMatch(/^\[redacted\]:\d+chars$/);
    expect(out.authorization).not.toContain("xyz");
    // Non-sensitive headers must survive, or the trace stops being useful.
    expect(out.accept).toBe("*/*");
  });

  it("strips secrets from query strings without losing the route", () => {
    const out = redactUrl("https://x.test/api/generate?token=supersecret&animation=shake");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("/api/generate");
    expect(out).toContain("animation=shake");
  });

  it("strips secrets from JSON and form bodies", () => {
    expect(redactBody('{"token":"abc","animation":"spin"}')).not.toContain("abc");
    expect(redactBody('{"token":"abc","animation":"spin"}')).toContain("spin");
    expect(redactBody("api_key=abc&size=128")).not.toContain("abc");
  });

  it("truncates oversized bodies", () => {
    const body = redactBody("x".repeat(20_000));
    expect(body!.length).toBeLessThan(5000);
    expect(body).toContain("truncated");
  });

  it("passes null through", () => {
    expect(redactBody(null)).toBeNull();
  });
});

describe("control mapping", () => {
  it("maps labels to option keys", () => {
    expect(mapControlToOption("animation | Animation")).toBe("animation");
    expect(mapControlToOption("speed | Speed")).toBe("speed");
    expect(mapControlToOption("Output format")).toBe("format");
    expect(mapControlToOption("Background colour")).toBe("color");
    expect(mapControlToOption("Emoji size in px")).toBe("size");
  });

  it("returns null when nothing matches", () => {
    expect(mapControlToOption("newsletter signup")).toBeNull();
  });
});

describe("processing classification", () => {
  const base = {
    url: "x", bytes: 0, status: 200, endpoints: [], clientSideHits: [], backendHits: [],
    sourceMappingUrl: null, sourceMapAvailable: false, sourceMapSources: [],
  };

  it("calls it client-side when an in-browser encoder is present and no endpoint is", () => {
    expect(classifyProcessing([{ ...base, clientSideHits: ["gif.js"] }]).verdict).toBe("client-side");
  });

  it("calls it backend when real endpoints appear", () => {
    expect(classifyProcessing([{ ...base, endpoints: ["/api/generate"] }]).verdict).toBe("backend");
  });

  it("does not treat bare fetch/FormData as proof of a backend", () => {
    // Every modern bundle has these; treating them as evidence would produce a
    // confident and wrong verdict.
    expect(classifyProcessing([{ ...base, backendHits: ["fetch", "FormData"] }]).verdict)
      .toBe("inconclusive");
  });
});

describe("discovery against a fixture editor", () => {
  let site: FixtureSite;
  let outputDir: string;

  beforeAll(async () => {
    site = await startFixtureSite();
    outputDir = mkdtempSync(join(tmpdir(), "discovery-"));
  }, 60_000);

  afterAll(async () => { await site?.close(); });

  it("drives the page and produces a usable manifest and report", async () => {
    const outcome = await discover({
      siteUrl: site.url,
      outputDir,
      testImage: await testImage(128),
      stepTimeoutMs: 15_000,
    });

    // Every step of the flow has to have worked.
    const failed = outcome.steps.filter(s => !s.ok);
    expect(failed.map(f => `${f.step}: ${f.detail}`)).toEqual([]);

    // Reachability probed both ways.
    expect(outcome.reachability.some(r => r.method === "node-fetch" && r.ok)).toBe(true);
    expect(outcome.reachability.some(r => r.method === "browser" && r.ok)).toBe(true);

    // The manifest picked up the real controls and their real values.
    expect(outcome.manifest.verified).toBe(true);
    // A single file input is normalised to the stable `input[type=file]`
    // selector so minor DOM churn doesn't break the browser provider.
    expect(outcome.manifest.browser.fileInputSelector).toBe("input[type=file]");
    expect(outcome.manifest.controls.animation?.values.map(v => v.value))
      .toEqual(["shake", "spin", "bounce"]);
    expect(outcome.manifest.controls.speed?.values.map(v => v.value))
      .toEqual(["slow", "normal", "fast"]);
    expect(outcome.manifest.controls.direction?.values.map(v => v.value))
      .toEqual(["left", "right"]);
    expect(outcome.manifest.controls.format?.values.map(v => v.value))
      .toEqual(["gif", "png", "webp"]);

    // And it retrieved the actual generated bytes.
    expect(outcome.result.obtained).toBe(true);
    expect(outcome.result.bytes).toBeGreaterThan(0);

    // The fixture generates in-page, so the run must NOT claim a backend.
    expect(outcome.processing?.verdict).not.toBe("backend");

    // The written manifest round-trips through the schema the provider reads.
    const written = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"));
    expect(Manifest.safeParse(written).success).toBe(true);

    for (const file of ["network.json", "relevant-requests.json", "inventory.json", "bundles.json", "report.md"]) {
      expect(existsSync(join(outputDir, file)), file).toBe(true);
    }

    const report = readFileSync(join(outputDir, "report.md"), "utf8");
    expect(report).toContain("# MakeEmoji investigation");
    expect(report).toContain("## Verdict");
    expect(report).toContain("## Control inventory");
  }, 180_000);
});

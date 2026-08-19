import { afterEach, describe, expect, it } from "vitest";
import { resolvedEnv, resolvedHttpUrl } from "../runtime-env.js";

const originalValues = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!originalValues.has(name)) originalValues.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of originalValues) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  originalValues.clear();
});

describe("resolvedEnv", () => {
  it("returns a configured value", () => {
    setEnv("TEST_RUNTIME_ENV", " configured ");
    expect(resolvedEnv("TEST_RUNTIME_ENV")).toBe("configured");
  });

  it.each([
    undefined,
    "",
    "${MISSING_SECRET}",
    "prefix-${MISSING_SECRET}",
  ])("rejects missing or unresolved values: %s", (value) => {
    setEnv("TEST_RUNTIME_ENV", value);
    expect(resolvedEnv("TEST_RUNTIME_ENV")).toBeNull();
  });
});

describe("resolvedHttpUrl", () => {
  it("returns an absolute HTTP(S) URL", () => {
    setEnv("TEST_RUNTIME_URL", "https://dn-cards.replit.app");
    expect(resolvedHttpUrl("TEST_RUNTIME_URL")).toBe("https://dn-cards.replit.app/");
  });

  it.each([
    "${ACTIVITY_URL}",
    "/relative",
    "not-a-url",
    "javascript:alert(1)",
  ])("rejects an invalid browser URL: %s", (value) => {
    setEnv("TEST_RUNTIME_URL", value);
    expect(resolvedHttpUrl("TEST_RUNTIME_URL")).toBeNull();
  });
});
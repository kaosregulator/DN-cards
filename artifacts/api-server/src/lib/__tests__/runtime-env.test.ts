import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  databaseHost,
  deploymentProcessType,
  isPublishedDeployment,
  publicBaseUrl,
  resolvedEnv,
  resolvedHttpUrl,
} from "../runtime-env.js";

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

const DEPLOY_KEYS = [
  "REPLIT_DEPLOYMENT",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_SERVICE_ID",
  "DN_DEPLOYMENT",
  "PUBLIC_BASE_URL",
  "RAILWAY_PUBLIC_DOMAIN",
  "REPLIT_DOMAINS",
  "DATABASE_URL",
] as const;

describe("deployment detection", () => {
  beforeEach(() => {
    for (const k of DEPLOY_KEYS) setEnv(k, undefined);
  });

  it("treats local as dev by default", () => {
    expect(isPublishedDeployment()).toBe(false);
    expect(deploymentProcessType()).toBe("dev");
  });

  it("detects Replit deployment", () => {
    setEnv("REPLIT_DEPLOYMENT", "1");
    expect(isPublishedDeployment()).toBe(true);
  });

  it("detects Railway via RAILWAY_ENVIRONMENT", () => {
    setEnv("RAILWAY_ENVIRONMENT", "production");
    expect(isPublishedDeployment()).toBe(true);
    expect(deploymentProcessType()).toBe("deployment");
  });

  it("detects Railway via RAILWAY_SERVICE_ID", () => {
    setEnv("RAILWAY_SERVICE_ID", "abc");
    expect(isPublishedDeployment()).toBe(true);
  });

  it("honours DN_DEPLOYMENT escape hatch", () => {
    setEnv("DN_DEPLOYMENT", "1");
    expect(isPublishedDeployment()).toBe(true);
  });

  it("prefers PUBLIC_BASE_URL", () => {
    setEnv("PUBLIC_BASE_URL", "https://cards.example/");
    setEnv("RAILWAY_PUBLIC_DOMAIN", "ignored.up.railway.app");
    expect(publicBaseUrl()).toBe("https://cards.example");
  });

  it("uses Railway public domain when set", () => {
    setEnv("RAILWAY_PUBLIC_DOMAIN", "dn.up.railway.app");
    expect(publicBaseUrl()).toBe("https://dn.up.railway.app");
  });

  it("extracts database host without leaking credentials", () => {
    setEnv("DATABASE_URL", "postgresql://user:secret@db.example:5432/app");
    expect(databaseHost()).toBe("db.example");
  });
});

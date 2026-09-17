import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildPoolConfig } from "../../../../../lib/db/src/pool-config.js";

describe("buildPoolConfig", () => {
  const prev = process.env.DATABASE_SSL;

  beforeEach(() => {
    delete process.env.DATABASE_SSL;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = prev;
  });

  it("does not enable ssl for localhost", () => {
    const cfg = buildPoolConfig("postgresql://u:p@localhost:5432/db");
    expect(cfg.ssl).toBeUndefined();
  });

  it("enables ssl for Railway hosts", () => {
    const cfg = buildPoolConfig("postgresql://u:p@maglev.proxy.rlwy.net:1234/railway");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("respects DATABASE_SSL=disable", () => {
    process.env.DATABASE_SSL = "disable";
    const cfg = buildPoolConfig("postgresql://u:p@maglev.proxy.rlwy.net:1234/railway");
    expect(cfg.ssl).toBeUndefined();
  });

  it("respects DATABASE_SSL=require on local urls", () => {
    process.env.DATABASE_SSL = "require";
    const cfg = buildPoolConfig("postgresql://u:p@127.0.0.1:5432/db");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });
});

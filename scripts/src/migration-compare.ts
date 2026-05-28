import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type Row = Record<string, unknown>;
type Snapshot = {
  version: number;
  generatedAt: string;
  label: string | null;
  tables: Record<string, Row[]>;
  summaries?: Record<string, unknown>;
  integrity?: { ok: boolean; errors: string[]; warnings: string[] };
};

type Args = {
  before: string;
  after: string;
  out: string | null;
  allowExtra: boolean;
};

type Finding = { severity: "error" | "warning"; area: string; message: string };

function usage(): string {
  return [
    "Usage: pnpm --filter @workspace/scripts run migration:compare -- --before exports/pre.json --after exports/post.json [--out exports/report.json] [--allow-extra]",
    "",
    "Compares two migration snapshots and fails on missing/mismatched gameplay-critical data.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { before: "", after: "", out: null, allowExtra: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--before") {
      args.before = argv[++i] ?? "";
      continue;
    }
    if (arg === "--after") {
      args.after = argv[++i] ?? "";
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++i] ?? "";
      continue;
    }
    if (arg === "--allow-extra") {
      args.allowExtra = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.before || !args.after) throw new Error(`Missing --before or --after.\n${usage()}`);
  return args;
}

async function readSnapshot(file: string): Promise<Snapshot> {
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as Snapshot;
  if (!parsed.tables || typeof parsed.tables !== "object") throw new Error(`${file} is not a migration snapshot`);
  return parsed;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function keyOf(row: Row, fields: string[]): string {
  return fields.map(f => str(row[f])).join(":");
}

function indexBy(rows: Row[], fields: string[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const row of rows) out.set(keyOf(row, fields), row);
  return out;
}

function add(findings: Finding[], severity: Finding["severity"], area: string, message: string): void {
  findings.push({ severity, area, message });
}

function compareTableCounts(before: Snapshot, after: Snapshot, findings: Finding[], allowExtra: boolean): void {
  const critical = [
    "cards", "collections", "userCurrency", "achievements", "guildSettings",
    "sets", "cardSetMemberships", "wishlists", "trades",
  ];
  for (const name of critical) {
    const a = before.tables[name]?.length ?? 0;
    const b = after.tables[name]?.length ?? 0;
    if (b < a) add(findings, "error", "table-count", `${name}: before=${a}, after=${b}`);
    else if (b > a && !allowExtra) add(findings, "warning", "table-count", `${name}: after has ${b - a} extra rows`);
  }
}

function compareCards(before: Snapshot, after: Snapshot, findings: Finding[], allowExtra: boolean): void {
  const beforeCards = indexBy(before.tables["cards"] ?? [], ["id"]);
  const afterCards = indexBy(after.tables["cards"] ?? [], ["id"]);
  for (const [id, beforeCard] of beforeCards) {
    const afterCard = afterCards.get(id);
    if (!afterCard) {
      add(findings, "error", "cards", `Missing card id ${id} (${beforeCard["name"] ?? "unknown"})`);
      continue;
    }
    for (const field of ["name", "rarity", "cardType", "isArchived", "isLimitedEdition", "isEventExclusive", "maxCopies"]) {
      if (str(beforeCard[field]) !== str(afterCard[field])) {
        add(findings, "error", "cards", `Card ${id} field ${field} changed: ${str(beforeCard[field])} -> ${str(afterCard[field])}`);
      }
    }
  }
  if (!allowExtra) {
    for (const id of afterCards.keys()) if (!beforeCards.has(id)) add(findings, "warning", "cards", `Extra card id ${id} exists after migration`);
  }
}

function compareCollections(before: Snapshot, after: Snapshot, findings: Finding[], allowExtra: boolean): void {
  const beforeRows = indexBy(before.tables["collections"] ?? [], ["guildId", "userId", "cardId"]);
  const afterRows = indexBy(after.tables["collections"] ?? [], ["guildId", "userId", "cardId"]);
  for (const [key, beforeRow] of beforeRows) {
    const afterRow = afterRows.get(key);
    if (!afterRow) {
      add(findings, "error", "collections", `Missing ownership row ${key}`);
      continue;
    }
    for (const field of ["count", "shinyCount"]) {
      if (num(beforeRow[field]) !== num(afterRow[field])) {
        add(findings, "error", "collections", `${key} ${field} changed: ${num(beforeRow[field])} -> ${num(afterRow[field])}`);
      }
    }
  }
  if (!allowExtra) {
    for (const key of afterRows.keys()) if (!beforeRows.has(key)) add(findings, "warning", "collections", `Extra ownership row ${key}`);
  }
}

function compareCurrency(before: Snapshot, after: Snapshot, findings: Finding[], allowExtra: boolean): void {
  const beforeRows = indexBy(before.tables["userCurrency"] ?? [], ["guildId", "userId"]);
  const afterRows = indexBy(after.tables["userCurrency"] ?? [], ["guildId", "userId"]);
  for (const [key, beforeRow] of beforeRows) {
    const afterRow = afterRows.get(key);
    if (!afterRow) {
      add(findings, "error", "currency", `Missing currency row ${key}`);
      continue;
    }
    for (const field of ["shards", "totalEarned", "packsOpened", "cardsBurned", "packBasicOpenedWeek", "packPremiumOpenedWeek", "packLegendaryOpenedWeek"]) {
      if (num(beforeRow[field]) !== num(afterRow[field])) {
        add(findings, "error", "currency", `${key} ${field} changed: ${num(beforeRow[field])} -> ${num(afterRow[field])}`);
      }
    }
  }
  if (!allowExtra) {
    for (const key of afterRows.keys()) if (!beforeRows.has(key)) add(findings, "warning", "currency", `Extra currency row ${key}`);
  }
}

function compareCompositeRows(
  before: Snapshot,
  after: Snapshot,
  findings: Finding[],
  table: string,
  fields: string[],
  compareFields: string[],
  allowExtra: boolean,
): void {
  const beforeRows = indexBy(before.tables[table] ?? [], fields);
  const afterRows = indexBy(after.tables[table] ?? [], fields);
  for (const [key, beforeRow] of beforeRows) {
    const afterRow = afterRows.get(key);
    if (!afterRow) {
      add(findings, "error", table, `Missing row ${key}`);
      continue;
    }
    for (const field of compareFields) {
      if (str(beforeRow[field]) !== str(afterRow[field])) {
        add(findings, "error", table, `${key} ${field} changed: ${str(beforeRow[field])} -> ${str(afterRow[field])}`);
      }
    }
  }
  if (!allowExtra) {
    for (const key of afterRows.keys()) if (!beforeRows.has(key)) add(findings, "warning", table, `Extra row ${key}`);
  }
}

function compareSummaries(before: Snapshot, after: Snapshot, findings: Finding[]): void {
  const beforeCollections = (before.summaries?.["collections"] ?? {}) as any;
  const afterCollections = (after.summaries?.["collections"] ?? {}) as any;
  for (const field of ["normalCopies", "shinyCopies", "totalCopies"]) {
    if (num(beforeCollections[field]) !== num(afterCollections[field])) {
      add(findings, "error", "summary", `collections.${field} changed: ${num(beforeCollections[field])} -> ${num(afterCollections[field])}`);
    }
  }
  const beforeCurrency = ((before.summaries?.["currency"] ?? {}) as any).totals ?? {};
  const afterCurrency = ((after.summaries?.["currency"] ?? {}) as any).totals ?? {};
  for (const field of ["shards", "totalEarned", "packsOpened", "cardsBurned"]) {
    if (num(beforeCurrency[field]) !== num(afterCurrency[field])) {
      add(findings, "error", "summary", `currency.${field} changed: ${num(beforeCurrency[field])} -> ${num(afterCurrency[field])}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [before, after] = await Promise.all([readSnapshot(args.before), readSnapshot(args.after)]);
  const findings: Finding[] = [];

  if (before.version !== after.version) add(findings, "warning", "snapshot", `Snapshot versions differ: ${before.version} vs ${after.version}`);
  if (before.integrity && !before.integrity.ok) add(findings, "warning", "snapshot", `Before snapshot had ${before.integrity.errors.length} integrity errors`);
  if (after.integrity && !after.integrity.ok) add(findings, "error", "snapshot", `After snapshot has ${after.integrity.errors.length} integrity errors`);

  compareTableCounts(before, after, findings, args.allowExtra);
  compareCards(before, after, findings, args.allowExtra);
  compareCollections(before, after, findings, args.allowExtra);
  compareCurrency(before, after, findings, args.allowExtra);
  compareCompositeRows(before, after, findings, "achievements", ["guildId", "userId", "achievementKey"], [], args.allowExtra);
  compareCompositeRows(before, after, findings, "cardSetMemberships", ["cardId", "setId"], [], args.allowExtra);
  compareCompositeRows(before, after, findings, "sets", ["id"], ["name", "awardsCompletion"], args.allowExtra);
  compareCompositeRows(before, after, findings, "guildSettings", ["guildId"], ["activeSetId", "spawnChannelId", "tradeChannelId"], args.allowExtra);
  compareCompositeRows(before, after, findings, "wishlists", ["guildId", "userId", "cardId"], [], args.allowExtra);
  compareSummaries(before, after, findings);

  const errors = findings.filter(f => f.severity === "error");
  const warnings = findings.filter(f => f.severity === "warning");
  const report = {
    ok: errors.length === 0,
    before: { file: args.before, label: before.label, generatedAt: before.generatedAt },
    after: { file: args.after, label: after.label, generatedAt: after.generatedAt },
    errors: errors.length,
    warnings: warnings.length,
    findings,
  };

  if (args.out) {
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await writeFile(args.out, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  console.log(`Migration comparison: ${report.ok ? "PASS" : "FAIL"} (${errors.length} errors, ${warnings.length} warnings)`);
  for (const finding of findings.slice(0, 50)) {
    const prefix = finding.severity === "error" ? "ERROR" : "WARN";
    console.log(`${prefix} [${finding.area}] ${finding.message}`);
  }
  if (findings.length > 50) console.log(`... ${findings.length - 50} more findings`);
  if (!report.ok) process.exitCode = 2;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

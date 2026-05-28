import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_VERSION = 1;

type Row = Record<string, unknown>;
type TableRows = Record<string, Row[]>;
type CountMap = Record<string, number>;
type StringMap = Record<string, string>;

type IntegrityCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

type Snapshot = {
  version: number;
  generatedAt: string;
  label: string | null;
  tables: TableRows;
  summaries: Record<string, unknown>;
  integrity: IntegrityCheck;
};

type Args = {
  out: string;
  label: string | null;
  pretty: boolean;
  failOnIntegrity: boolean;
};

function usage(): string {
  return [
    "Usage: pnpm --filter @workspace/scripts run migration:snapshot -- --out exports/pre-oracle.json [--label pre-oracle] [--pretty] [--fail-on-integrity]",
    "",
    "Exports a read-only gameplay data snapshot for migration validation.",
    "Requires DATABASE_URL to point at the source database.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "", label: null, pretty: false, failOnIntegrity: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[++i] ?? "";
      continue;
    }
    if (arg === "--label") {
      args.label = argv[++i] ?? null;
      continue;
    }
    if (arg === "--pretty") {
      args.pretty = true;
      continue;
    }
    if (arg === "--fail-on-integrity") {
      args.failOnIntegrity = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.out) throw new Error(`Missing required --out.\n${usage()}`);
  return args;
}

function normalizeRows(rows: unknown[]): Row[] {
  return JSON.parse(JSON.stringify(rows)) as Row[];
}

function stableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function stableSortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const aId = stableValue(a["id"] ?? `${a["guildId"] ?? ""}:${a["userId"] ?? ""}:${a["cardId"] ?? ""}:${a["setId"] ?? ""}:${a["achievementKey"] ?? ""}`);
    const bId = stableValue(b["id"] ?? `${b["guildId"] ?? ""}:${b["userId"] ?? ""}:${b["cardId"] ?? ""}:${b["setId"] ?? ""}:${b["achievementKey"] ?? ""}`);
    return aId.localeCompare(bId);
  });
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function inc(map: CountMap, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function setMap(map: StringMap, key: string, value: string): void {
  map[key] = value;
}

function keyOf(row: Row, fields: string[]): string {
  return fields.map(f => str(row[f])).join(":");
}

async function loadRows(): Promise<{ tables: TableRows; close: () => Promise<void> }> {
  const dbPackageName = "@workspace" + "/db";
  const dbModule = await import(dbPackageName) as any;
  const tableDefs: Array<[string, unknown]> = [
    ["cards", dbModule.cardsTable],
    ["collections", dbModule.collectionsTable],
    ["userCurrency", dbModule.userCurrencyTable],
    ["achievements", dbModule.achievementsTable],
    ["dailyClaims", dbModule.dailyClaimsTable],
    ["guildSettings", dbModule.guildSettingsTable],
    ["sets", dbModule.setsTable],
    ["cardSetMemberships", dbModule.cardSetMembershipsTable],
    ["wishlists", dbModule.wishlistsTable],
    ["trades", dbModule.tradesTable],
    ["adminUsers", dbModule.adminUsersTable],
    ["rarityProfiles", dbModule.rarityProfilesTable],
    ["customRarities", dbModule.customRaritiesTable],
    ["cardRarityOverrides", dbModule.cardRarityOverridesTable],
    ["rarityDisplayOverrides", dbModule.rarityDisplayOverridesTable],
    ["cardEvents", dbModule.cardEventsTable],
    ["embedOverrides", dbModule.embedOverridesTable],
    ["cardDisplayOverrides", dbModule.cardDisplayOverridesTable],
  ];

  const tables: TableRows = {};
  for (const [name, table] of tableDefs) {
    const rows = await dbModule.db.select().from(table as any);
    tables[name] = stableSortRows(normalizeRows(rows));
  }

  const close = async () => {
    if (dbModule.pool && typeof dbModule.pool.end === "function") await dbModule.pool.end();
  };
  return { tables, close };
}

function summarize(tables: TableRows): Record<string, unknown> {
  const cards = tables["cards"] ?? [];
  const collections = tables["collections"] ?? [];
  const currency = tables["userCurrency"] ?? [];
  const achievements = tables["achievements"] ?? [];
  const sets = tables["sets"] ?? [];
  const memberships = tables["cardSetMemberships"] ?? [];
  const guildSettings = tables["guildSettings"] ?? [];
  const wishlists = tables["wishlists"] ?? [];

  const cardIdentity: StringMap = {};
  for (const card of cards) {
    setMap(
      cardIdentity,
      str(card["id"]),
      [card["name"], card["rarity"], card["cardType"], card["isArchived"]].map(stableValue).join("|"),
    );
  }

  const collectionByGuild: CountMap = {};
  const collectionByUser: CountMap = {};
  const collectionByCard: CountMap = {};
  let normalCopies = 0;
  let shinyCopies = 0;
  for (const row of collections) {
    const normal = num(row["count"]);
    const shiny = num(row["shinyCount"]);
    normalCopies += normal;
    shinyCopies += shiny;
    inc(collectionByGuild, str(row["guildId"]), normal + shiny);
    inc(collectionByUser, keyOf(row, ["guildId", "userId"]), normal + shiny);
    inc(collectionByCard, str(row["cardId"]), normal + shiny);
  }

  const currencyByUser: Record<string, Record<string, number>> = {};
  const currencyTotals = { shards: 0, totalEarned: 0, packsOpened: 0, cardsBurned: 0 };
  for (const row of currency) {
    const key = keyOf(row, ["guildId", "userId"]);
    const value = {
      shards: num(row["shards"]),
      totalEarned: num(row["totalEarned"]),
      packsOpened: num(row["packsOpened"]),
      cardsBurned: num(row["cardsBurned"]),
    };
    currencyByUser[key] = value;
    currencyTotals.shards += value.shards;
    currencyTotals.totalEarned += value.totalEarned;
    currencyTotals.packsOpened += value.packsOpened;
    currencyTotals.cardsBurned += value.cardsBurned;
  }

  const achievementsByUser: CountMap = {};
  for (const row of achievements) inc(achievementsByUser, keyOf(row, ["guildId", "userId"]));

  const membershipsBySet: CountMap = {};
  for (const row of memberships) inc(membershipsBySet, str(row["setId"]));

  const activeSetByGuild: StringMap = {};
  for (const row of guildSettings) {
    if (row["activeSetId"] !== null && row["activeSetId"] !== undefined) setMap(activeSetByGuild, str(row["guildId"]), str(row["activeSetId"]));
  }

  return {
    tableCounts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    cards: { count: cards.length, identityById: cardIdentity },
    collections: {
      rows: collections.length,
      normalCopies,
      shinyCopies,
      totalCopies: normalCopies + shinyCopies,
      byGuild: collectionByGuild,
      byUser: collectionByUser,
      byCard: collectionByCard,
    },
    currency: { rows: currency.length, totals: currencyTotals, byUser: currencyByUser },
    achievements: { rows: achievements.length, byUser: achievementsByUser },
    sets: { rows: sets.length, memberships: memberships.length, membershipsBySet, activeSetByGuild },
    wishlists: { rows: wishlists.length },
  };
}

function integrity(tables: TableRows): IntegrityCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cards = tables["cards"] ?? [];
  const collections = tables["collections"] ?? [];
  const currency = tables["userCurrency"] ?? [];
  const achievements = tables["achievements"] ?? [];
  const sets = tables["sets"] ?? [];
  const memberships = tables["cardSetMemberships"] ?? [];
  const guildSettings = tables["guildSettings"] ?? [];
  const wishlists = tables["wishlists"] ?? [];

  const cardIds = new Set(cards.map(r => str(r["id"])));
  const setIds = new Set(sets.map(r => str(r["id"])));
  const collectionKeys = new Set<string>();
  const currencyKeys = new Set<string>();
  const achievementKeys = new Set<string>();

  for (const row of collections) {
    const key = keyOf(row, ["guildId", "userId", "cardId"]);
    if (collectionKeys.has(key)) errors.push(`Duplicate collection key ${key}`);
    collectionKeys.add(key);
    if (!cardIds.has(str(row["cardId"]))) errors.push(`Collection references missing card ${row["cardId"]} (${key})`);
    if (num(row["count"]) < 0 || num(row["shinyCount"]) < 0) errors.push(`Negative collection count ${key}`);
  }

  for (const row of currency) {
    const key = keyOf(row, ["guildId", "userId"]);
    if (currencyKeys.has(key)) errors.push(`Duplicate currency key ${key}`);
    currencyKeys.add(key);
    if (num(row["shards"]) < 0) warnings.push(`Negative shard balance ${key}`);
  }

  for (const row of achievements) {
    const key = keyOf(row, ["guildId", "userId", "achievementKey"]);
    if (achievementKeys.has(key)) errors.push(`Duplicate achievement key ${key}`);
    achievementKeys.add(key);
  }

  for (const row of memberships) {
    if (!cardIds.has(str(row["cardId"]))) errors.push(`Set membership references missing card ${row["cardId"]}`);
    if (!setIds.has(str(row["setId"]))) errors.push(`Set membership references missing set ${row["setId"]}`);
  }

  for (const row of guildSettings) {
    const activeSetId = row["activeSetId"];
    if (activeSetId !== null && activeSetId !== undefined && !setIds.has(str(activeSetId))) {
      errors.push(`Guild ${row["guildId"]} activeSetId references missing set ${activeSetId}`);
    }
  }

  for (const row of wishlists) {
    if (!cardIds.has(str(row["cardId"]))) errors.push(`Wishlist references missing card ${row["cardId"]}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { tables, close } = await loadRows();
  try {
    const snapshot: Snapshot = {
      version: SNAPSHOT_VERSION,
      generatedAt: new Date().toISOString(),
      label: args.label,
      tables,
      summaries: summarize(tables),
      integrity: integrity(tables),
    };

    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await writeFile(args.out, JSON.stringify(snapshot, null, args.pretty ? 2 : 0) + "\n", "utf8");

    console.log(`Migration snapshot written: ${args.out}`);
    console.log(`Integrity: ${snapshot.integrity.ok ? "ok" : "FAILED"} (${snapshot.integrity.errors.length} errors, ${snapshot.integrity.warnings.length} warnings)`);
    if (snapshot.integrity.errors.length > 0) console.error(snapshot.integrity.errors.map(e => `ERROR: ${e}`).join("\n"));
    if (snapshot.integrity.warnings.length > 0) console.warn(snapshot.integrity.warnings.map(w => `WARN: ${w}`).join("\n"));
    if (!snapshot.integrity.ok && args.failOnIntegrity) process.exitCode = 2;
  } finally {
    await close();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Read-only inventory of the live database.
 *
 * Run this BEFORE taking a backup to confirm what is actually in the database:
 * every table and its exact row count, a per-guild breakdown for the tables
 * that carry gameplay state, and an image-source audit for the cards table.
 *
 * This script only ever issues SELECTs. It never writes, drops, or migrates.
 *
 *   pnpm --filter @workspace/scripts run db:inventory
 *   pnpm --filter @workspace/scripts run db:inventory -- --guild 1363917781355069761
 *   pnpm --filter @workspace/scripts run db:inventory -- --json > exports/inventory.json
 *
 * Requires DATABASE_URL to point at the database you want to inspect.
 */

import { HOME_GUILD_ID } from "./lib/home-guild.js";

type Args = { guild: string; json: boolean };

type TableCount = { table: string; rows: number; guildRows: number | null };

type ImageBucket = { kind: string; count: number; sample: string | null };

type Inventory = {
  generatedAt: string;
  database: string;
  guildId: string;
  tables: TableCount[];
  totals: { tables: number; rows: number; guildRows: number };
  guilds: Array<{ guildId: string; cards: number; collections: number; users: number }>;
  cards: { total: number; guild: number; archived: number; droppable: number; byRarity: Record<string, number> };
  images: ImageBucket[];
  players: { users: number; collectionRows: number; totalCopies: number; shinyCopies: number };
  warnings: string[];
};

function usage(): string {
  return [
    "Usage: pnpm --filter @workspace/scripts run db:inventory -- [--guild <id>] [--json]",
    "",
    "Read-only. Prints every table with its row count, a per-guild breakdown,",
    "and an audit of where card images actually live.",
    "Requires DATABASE_URL.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { guild: HOME_GUILD_ID, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--guild") {
      args.guild = argv[++i] ?? "";
      if (!args.guild) throw new Error(`--guild needs a value.\n${usage()}`);
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

/** Redact credentials so the connection string is safe to print or commit. */
function safeDatabaseLabel(url: string | undefined): string {
  if (!url) return "(unset)";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Matches the indirection used by migration-snapshot.ts: the workspace package
  // is resolved at runtime so this file typechecks without the db build output.
  const dbPackageName = "@workspace" + "/db";
  const { pool } = (await import(dbPackageName)) as {
    pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; end: () => Promise<void> };
  };

  const warnings: string[] = [];

  // Every base table in the public schema, straight from the catalog. Reading
  // the catalog rather than the Drizzle schema means tables that exist in the
  // database but were never declared in code still show up here — exactly the
  // drift a backup needs to capture.
  const { rows: tableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const tableNames: string[] = tableRows.map((r) => r.table_name);

  // Which of those tables can be filtered by guild.
  const { rows: guildColRows } = await pool.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'guild_id'`,
  );
  const guildTables = new Set<string>(guildColRows.map((r) => r.table_name));

  const tables: TableCount[] = [];
  for (const table of tableNames) {
    // Exact counts, not reltuples estimates — a backup check that reports
    // "about 200 rows" is not a check.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM public."${table}"`);
    const total: number = rows[0]?.n ?? 0;

    let guildRows: number | null = null;
    if (guildTables.has(table)) {
      const { rows: g } = await pool.query(
        `SELECT count(*)::int AS n FROM public."${table}" WHERE guild_id = $1`,
        [args.guild],
      );
      guildRows = g[0]?.n ?? 0;
    }
    tables.push({ table, rows: total, guildRows });
  }

  // Per-guild footprint, so a multi-guild database is obvious before migrating.
  // Which tables carry guild_id has changed over time (cards only gained the
  // column in 2026), so the union is built from what the catalog actually
  // reports rather than from an assumption about the current schema.
  const guildSources = ["cards", "collections", "guild_settings"].filter(
    (t) => tableNames.includes(t) && guildTables.has(t),
  );

  let guildRows: any[] = [];
  if (guildSources.length > 0) {
    const cardsHasGuild = guildSources.includes("cards");
    const collectionsHasGuild = guildSources.includes("collections");
    const union = guildSources.map((t) => `SELECT guild_id FROM public."${t}"`).join(" UNION ");
    const cardsExpr = cardsHasGuild
      ? `(SELECT count(*)::int FROM public.cards c WHERE c.guild_id = g.guild_id)`
      : `0`;
    const collectionsExpr = collectionsHasGuild
      ? `(SELECT count(*)::int FROM public.collections co WHERE co.guild_id = g.guild_id)`
      : `0`;
    const usersExpr = collectionsHasGuild
      ? `(SELECT count(DISTINCT co.user_id)::int FROM public.collections co WHERE co.guild_id = g.guild_id)`
      : `0`;
    ({ rows: guildRows } = await pool.query(
      `SELECT g.guild_id AS "guildId",
              ${cardsExpr} AS cards,
              ${collectionsExpr} AS collections,
              ${usersExpr} AS users
         FROM (${union}) g
        WHERE g.guild_id IS NOT NULL
        ORDER BY cards DESC, collections DESC`,
    ));
    if (!cardsHasGuild) {
      warnings.push(
        "cards.guild_id does not exist in this database — it predates per-guild card " +
          "ownership. Per-guild card counts are reported as 0.",
      );
    }
  }

  const cardsHasGuildCol = guildTables.has("cards");
  const { rows: cardStats } = await pool.query(
    `SELECT count(*)::int AS total,
            ${cardsHasGuildCol ? "count(*) FILTER (WHERE guild_id = $1)::int" : "0"} AS guild,
            count(*) FILTER (WHERE is_archived)::int AS archived,
            count(*) FILTER (WHERE droppable)::int AS droppable
       FROM public.cards`,
    cardsHasGuildCol ? [args.guild] : [],
  );

  const { rows: rarityRows } = await pool.query(
    `SELECT rarity::text AS rarity, count(*)::int AS n
       FROM public.cards GROUP BY rarity ORDER BY n DESC`,
  );

  // Where card art actually lives. Object-storage paths and external URLs need
  // completely different backup treatment, so they are counted separately.
  const { rows: imageRows } = await pool.query(
    `SELECT CASE
              WHEN image_url IS NULL OR image_url = '' THEN 'missing'
              WHEN image_url LIKE '/objects/%' THEN 'replit-object-storage'
              WHEN image_url LIKE '/public-objects/%' THEN 'replit-object-storage-public'
              WHEN image_url ~* '^https?://' THEN 'external-url'
              ELSE 'other'
            END AS kind,
            count(*)::int AS n,
            min(image_url) AS sample
       FROM public.cards
      GROUP BY 1 ORDER BY n DESC`,
  );

  const { rows: playerRows } = await pool.query(
    `SELECT count(DISTINCT user_id)::int AS users,
            count(*)::int AS "collectionRows",
            coalesce(sum(count), 0)::int AS "totalCopies",
            coalesce(sum(shiny_count), 0)::int AS "shinyCopies"
       FROM public.collections`,
  );

  const images: ImageBucket[] = imageRows.map((r) => ({ kind: r.kind, count: r.n, sample: r.sample }));

  const external = images.find((i) => i.kind === "external-url");
  if (external && external.count > 0) {
    warnings.push(
      `${external.count} card image(s) point at an external host (e.g. ${external.sample}). ` +
        `A database dump does NOT capture these — if that host goes away the art is gone. ` +
        `Mirror them into object storage before migrating.`,
    );
  }
  const missing = images.find((i) => i.kind === "missing");
  if (missing && missing.count > 0) {
    warnings.push(`${missing.count} card(s) have no image_url set.`);
  }
  if (guildRows.length > 1) {
    warnings.push(
      `Database holds data for ${guildRows.length} guilds. Confirm you want all of them ` +
        `in the migration, not just ${args.guild}.`,
    );
  }

  const inventory: Inventory = {
    generatedAt: new Date().toISOString(),
    database: safeDatabaseLabel(process.env["DATABASE_URL"]),
    guildId: args.guild,
    tables,
    totals: {
      tables: tables.length,
      rows: tables.reduce((sum, t) => sum + t.rows, 0),
      guildRows: tables.reduce((sum, t) => sum + (t.guildRows ?? 0), 0),
    },
    guilds: guildRows as Inventory["guilds"],
    cards: {
      total: cardStats[0]?.total ?? 0,
      guild: cardStats[0]?.guild ?? 0,
      archived: cardStats[0]?.archived ?? 0,
      droppable: cardStats[0]?.droppable ?? 0,
      byRarity: Object.fromEntries(rarityRows.map((r) => [r.rarity, r.n])),
    },
    images,
    players: {
      users: playerRows[0]?.users ?? 0,
      collectionRows: playerRows[0]?.collectionRows ?? 0,
      totalCopies: playerRows[0]?.totalCopies ?? 0,
      shinyCopies: playerRows[0]?.shinyCopies ?? 0,
    },
    warnings,
  };

  await pool.end();

  if (args.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);

  console.log(`\nDatabase inventory — ${inventory.database}`);
  console.log(`Generated ${inventory.generatedAt}`);
  console.log(`Home guild ${inventory.guildId}\n`);

  console.log(`Cards      ${inventory.cards.total} total, ${inventory.cards.guild} in home guild, ` +
    `${inventory.cards.archived} archived, ${inventory.cards.droppable} droppable`);
  console.log(`Players    ${inventory.players.users} users, ${inventory.players.collectionRows} collection rows, ` +
    `${inventory.players.totalCopies} copies (${inventory.players.shinyCopies} shiny)`);
  console.log(`Schema     ${inventory.totals.tables} tables, ${inventory.totals.rows} rows total\n`);

  console.log("Cards by rarity");
  for (const [rarity, n] of Object.entries(inventory.cards.byRarity)) {
    console.log(`  ${pad(rarity, 14)}${padL(n, 6)}`);
  }

  console.log("\nCard image sources");
  for (const img of inventory.images) {
    console.log(`  ${pad(img.kind, 30)}${padL(img.count, 6)}   ${img.sample ?? ""}`);
  }

  console.log("\nPer-guild footprint");
  console.log(`  ${pad("guild_id", 22)}${padL("cards", 8)}${padL("collections", 13)}${padL("users", 7)}`);
  for (const g of inventory.guilds) {
    const mark = g.guildId === inventory.guildId ? " <- home" : "";
    console.log(`  ${pad(g.guildId, 22)}${padL(g.cards, 8)}${padL(g.collections, 13)}${padL(g.users, 7)}${mark}`);
  }

  console.log("\nTables (non-empty first)");
  const sorted = [...inventory.tables].sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
  for (const t of sorted) {
    if (t.rows === 0) continue;
    const guild = t.guildRows === null ? "" : `  (home guild: ${t.guildRows})`;
    console.log(`  ${pad(t.table, 34)}${padL(t.rows, 8)}${guild}`);
  }
  const empty = sorted.filter((t) => t.rows === 0).map((t) => t.table);
  console.log(`\n  ${empty.length} empty table(s): ${empty.join(", ") || "none"}`);

  if (inventory.warnings.length > 0) {
    console.log("\nWarnings");
    for (const w of inventory.warnings) console.log(`  ! ${w}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

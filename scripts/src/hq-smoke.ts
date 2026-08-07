// ─────────────────────────────────────────────────────────────────────────────
// /hq payload smoke check.
//
//   DATABASE_URL=… pnpm --filter @workspace/scripts run smoke:hq
//
// Builds EVERY `/hq` section for a throwaway player and validates the payload
// Discord would actually receive: at most five action rows, every select
// carrying 1–25 options, labels and descriptions inside their limits, embed
// fields under 1024 characters, and an image that rendered.
//
// These are the failures that don't show up in a typecheck and only surface as
// a 400 from the API in production — a select whose options list came back
// empty, or a section that grew a sixth row. Needs a database (it reads guild
// settings and the card pool) but no Discord connection.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";

import { __buildViewForTest, type HqSection } from "../../artifacts/api-server/src/bot/commands/hq-hub.js";
import { __buildServerPanelForTest } from "../../artifacts/api-server/src/bot/commands/hq-admin.js";
import { getOrCreateGuildSettings } from "../../artifacts/api-server/src/bot/db.js";

// discord.js is not a dependency of this package, so the builder types are
// taken from the hub's own return type rather than imported.
type HqView = Awaited<ReturnType<typeof __buildViewForTest>>;

const GUILD_ID = process.env["HQ_SMOKE_GUILD"] ?? "hq-smoke-guild";
const USER_ID = process.env["HQ_SMOKE_USER"] ?? "hq-smoke-user";

const SECTIONS: HqSection[] = [
  "overview", "trophy", "defenders", "world", "build",
  "decorations", "shop", "rooms", "theme",
];

// The minimum surface of a Discord interaction that buildView reads.
const interaction = {
  guildId: GUILD_ID,
  user: { id: USER_ID, username: "HQ Smoke", displayAvatarURL: () => null },
} as unknown as Parameters<typeof __buildViewForTest>[0];

async function main(): Promise<void> {
  await getOrCreateGuildSettings(GUILD_ID);
  console.log(`/hq payload smoke check — guild ${GUILD_ID}`);

  for (const section of SECTIONS) {
    const view = await __buildViewForTest(interaction, section);

    assert.ok(view.embeds.length >= 1, `${section}: produced no embed`);
    assert.ok(view.components.length <= 5,
      `${section}: ${view.components.length} action rows — Discord allows 5`);

    for (const row of view.components as HqView["components"]) {
      // toJSON() runs discord.js's own builder validation.
      const json = row.toJSON();
      assert.ok(json.components.length >= 1 && json.components.length <= 5,
        `${section}: an action row has ${json.components.length} components`);
      for (const c of json.components) {
        if (c.type === 3) {
          assert.ok(c.options.length >= 1 && c.options.length <= 25,
            `${section}: select "${c.custom_id}" has ${c.options.length} options`);
          for (const o of c.options) {
            assert.ok(o.label.length >= 1 && o.label.length <= 100,
              `${section}: select "${c.custom_id}" has a bad option label`);
            assert.ok(!o.description || o.description.length <= 100,
              `${section}: select "${c.custom_id}" has an over-long option description`);
          }
        }
        if (c.type === 2 && "custom_id" in c) {
          assert.ok(c.custom_id.length <= 100, `${section}: a button custom_id is too long`);
        }
      }
    }

    const embed = view.embeds[0]!.toJSON();
    assert.ok(!embed.title || embed.title.length <= 256, `${section}: embed title too long`);
    assert.ok(!embed.description || embed.description.length <= 4096, `${section}: embed description too long`);
    for (const f of embed.fields ?? []) {
      assert.ok(f.name.length <= 256, `${section}: field name too long`);
      assert.ok(f.value.length <= 1024, `${section}: field "${f.name}" is over 1024 characters`);
    }
    assert.ok(view.files.length > 0, `${section}: rendered no image`);

    console.log(
      `  ✓ ${section.padEnd(12)} ${view.components.length} row(s), ` +
      `${(embed.fields ?? []).length} field(s), image ok`,
    );
  }

  // The /hqadmin server panel is button- and select-driven, so it gets the same
  // payload check.
  const admin = await __buildServerPanelForTest(GUILD_ID);
  assert.ok(admin.embeds.length === 1, "the admin panel should be one embed");
  assert.ok(admin.components.length <= 5, "the admin panel has too many rows");
  for (const row of admin.components) {
    const json = row.toJSON();
    assert.ok(json.components.length >= 1 && json.components.length <= 5, "admin panel: bad row size");
    for (const c of json.components) {
      if (c.type === 3) {
        assert.ok(c.options.length >= 1 && c.options.length <= 25, "admin panel: bad select");
        for (const o of c.options) {
          assert.ok(!o.description || o.description.length <= 100, "admin panel: option description too long");
        }
      }
    }
  }
  const adminEmbed = admin.embeds[0]!.toJSON();
  for (const f of adminEmbed.fields ?? []) {
    assert.ok(f.value.length <= 1024, `admin panel: field "${f.name}" over 1024 chars`);
  }
  console.log(`  ✓ ${"/hqadmin".padEnd(12)} ${admin.components.length} row(s), ${(adminEmbed.fields ?? []).length} field(s), server siege panel`);

  console.log(`\nAll ${SECTIONS.length} /hq sections + the /hqadmin server panel build valid Discord payloads.`);
  process.exit(0);
}

void main();

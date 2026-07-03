import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index";
import { pool } from "@workspace/db";
import { SEED_SQL } from "./lib/seedData.js";

// Idempotent runtime migrations. Drizzle `db push` only runs against dev;
// production gets schema changes applied here on boot. Each statement uses
// `IF NOT EXISTS` so reruns are safe.
async function runBootMigrations() {
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS podium_place integer`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cards_podium_place_uniq ON cards (podium_place) WHERE podium_place IS NOT NULL`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS preview_animation text`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS preview_bg_color text`);
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS display_orientation text`);
  await pool.query(`ALTER TABLE card_display_overrides ADD COLUMN IF NOT EXISTS display_category text`);

  // Convert card_type from enum → text so admins can use any free-form label.
  // Idempotent: only runs while the column still has the enum type.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cards' AND column_name = 'card_type'
          AND data_type = 'USER-DEFINED'
      ) THEN
        ALTER TABLE cards ALTER COLUMN card_type TYPE text USING card_type::text;
        ALTER TABLE cards ALTER COLUMN card_type SET DEFAULT 'vehicle';
      END IF;
    END $$;
  `);

  // One-time data fix: when the dashboard moved from /dashboard/ to / (May 2026),
  // seed event card images stored as "https://<host>/dashboard/<file>" stopped
  // resolving. Convert any such absolute URL to a relative "/<file>" so they
  // load from whichever domain the user is on. Idempotent — only matches rows
  // that still have the old prefix.
  await pool.query(`
    UPDATE cards
       SET image_url = regexp_replace(image_url, '^https?://[^/]+/dashboard/', '/')
     WHERE image_url ~ '^https?://[^/]+/dashboard/'
  `);

  // Legacy rarity assignment cleanup: early Setup Hub builds could persist a
  // built-in rarity name in card_rarity_overrides.custom_rarity_slug. That row
  // does not join to custom_rarities, so resolvers fell back to cards.rarity
  // (often "common"). Promote those orphan built-in assignments into cards.rarity
  // and remove only the orphan rows. Real custom tiers with the same slug are
  // preserved by the NOT EXISTS guard.
  await pool.query(`
    WITH legacy_builtin AS (
      SELECT o.guild_id, o.card_id, o.custom_rarity_slug
      FROM card_rarity_overrides o
      WHERE o.custom_rarity_slug IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')
        AND NOT EXISTS (
          SELECT 1
          FROM custom_rarities c
          WHERE c.guild_id = o.guild_id
            AND c.slug = o.custom_rarity_slug
        )
    )
    UPDATE cards
       SET rarity = legacy_builtin.custom_rarity_slug::rarity
      FROM legacy_builtin
     WHERE cards.id = legacy_builtin.card_id
       AND cards.rarity::text <> legacy_builtin.custom_rarity_slug
  `);
  await pool.query(`
    DELETE FROM card_rarity_overrides o
    WHERE o.custom_rarity_slug IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')
      AND NOT EXISTS (
        SELECT 1
        FROM custom_rarities c
        WHERE c.guild_id = o.guild_id
          AND c.slug = o.custom_rarity_slug
      )
  `);

  // One-time backfill: if no card currently holds a podium slot, seed it from
  // the old name-based heuristic (1st/2nd/3rd in the name of an event card).
  // Idempotent — once any card has podium_place set, the inner NOT EXISTS
  // guard makes this a no-op so admin picks are never overwritten. DISTINCT ON
  // picks a single winner per slot deterministically (lowest id).
  const { rows: existing } = await pool.query(`SELECT 1 FROM cards WHERE podium_place IS NOT NULL LIMIT 1`);
  if (existing.length === 0) {
    await pool.query(`
      UPDATE cards
      SET podium_place = sub.place
      FROM (
        SELECT DISTINCT ON (place) id, place FROM (
          SELECT id,
            CASE
              WHEN name ~* '\\m1st\\M' THEN 1
              WHEN name ~* '\\m2nd\\M' THEN 2
              WHEN name ~* '\\m3rd\\M' THEN 3
            END AS place
          FROM cards
          WHERE is_event_exclusive = true AND is_archived = false
        ) ranked
        WHERE place IS NOT NULL
        ORDER BY place, id
      ) sub
      WHERE cards.id = sub.id
    `);
    logger.info("Podium backfill applied from card-name heuristic");
  }

  // One-time production data seed — runs only when cards table is empty.
  // Executed inside a single transaction: the cards_name_unique constraint is
  // dropped then re-added atomically, so a mid-run failure rolls back completely.
  const { rows: cardCheck } = await pool.query(`SELECT 1 FROM cards LIMIT 1`);
  if (cardCheck.length === 0) {
    logger.info("Cards table empty — running production data seed");
    const seedClient = await pool.connect();
    try {
      await seedClient.query("BEGIN");
      for (const stmt of SEED_SQL) {
        await seedClient.query(stmt);
      }
      await seedClient.query("COMMIT");
      logger.info({ count: SEED_SQL.length }, "Production seed complete");
    } catch (err) {
      await seedClient.query("ROLLBACK");
      throw err;
    } finally {
      seedClient.release();
    }
  }






  // Corrective data migration: fix card names (315-329), add card 329, gold_legendary rarity,
  // rarity overrides, user_currency, achievements, daily_claims.
  // Wrapped in a single transaction so that the cards_name_unique constraint is always
  // either fully applied or fully rolled back — never left in a dropped state.
  await (async () => {
    // Ensure user_currency has a unique index on (guild_id, user_id) so ON CONFLICT works.
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS user_currency_guild_user_uniq ON user_currency(guild_id, user_id);"
    );
    const client = await (await import("@workspace/db")).pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_name_unique;");
      const _dataMigrations: string[] = [
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(315,'BOB','The Face. The Legend. The Cult. Awarded to members present during the Great Bob Awakening. Grants unlimited emotional support and questionable tactical advice.','rare',0,'/card-bob.png','2026-05-25T05:52:12.999Z','limited',5000,2500,false,true,NULL,2,NULL,false,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(316,'Founding Soldier','Awarded to the first soldiers present during the launch of the DN Card System. Military Tycoon DN \u2014 Launch Event. The beginning of every great operation.','legendary',0,'/card-founding-soldier.png','2026-05-25T05:52:12.999Z','event',7500,3750,true,true,NULL,0,NULL,false,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(317,'DN Owner','The Owner of DN. The leader who builds, creates, and leads the community to victory. Respect the Owner. Respect the Vision. \u2014 Artem_Kukuruza','rare',0,'/card-dn-owner.png','2026-05-25T05:52:12.999Z','limited',10000,5000,true,true,NULL,4,NULL,false,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(318,'Patriot Event 1st Place','1st Place \u2014 evgeni2372006 \u2014 36 kills. The highest kill count of the event. Every Patriot launched brought them closer to victory.','legendary',0,'/card-patriot-1st.png','2026-05-25T05:52:12.999Z','achievement',7500,3750,false,true,NULL,0,NULL,false,false,false,1) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(319,'Patriot Event 2nd Place','2nd Place \u2014 tobiqwe123 \u2014 35 kills. One elimination short of glory, yet feared by every opponent.','legendary',0,'/card-patriot-2nd.png','2026-05-25T05:52:12.999Z','achievement',5000,2500,false,true,NULL,0,NULL,false,false,false,2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(320,'Patriot Event 3rd Place','3rd Place \u2014 ArtificiallyAbove \u2014 21 kills. Outnumbered but never outmatched. A place on the podium was earned through persistence and skill.','rare',0,'/card-patriot-3rd.png','2026-05-25T05:52:12.999Z','event',3000,1500,false,true,NULL,0,NULL,false,false,false,3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(323,'Rainbow Dark Star','Only given by admins','legendary',0,'https://cdn.discordapp.com/attachments/1478770197975400549/1508659815994363914/file_00000000348871fdb3e982d0679faffc.png?ex=6a165871&is=6a1506f1&hm=2a5ddbd9414f312fb829a753974c06839f4f2ed45408bac7c49c93a092e80aab&','2026-05-26T02:35:39.486Z','event',7777777,7777777,false,false,NULL,3,NULL,false,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(324,'Super Raptor','Can dodge all normal missiles by spamming A & D with its super sonic dodge ability. Also has 2 fighting modes you can swap between','legendary',0,'/card-super-raptor.png','2026-05-28T05:23:05.666Z','aircraft',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(325,'Golden Mi-35','A bulky helicopter with decent speed and damage, comes with barrage missiles. A good choice for boss fights.','legendary',0,'/card-golden-mi35.png','2026-05-28T05:23:07.442Z','aircraft',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(326,'Super Hovercraft','A hovercraft with a lock on rockets that deal low damage. The Super Hovercraft was only obtainable from a limited wheel spin, making it rare and sought after.','legendary',0,'/card-super-hovercraft.png','2026-05-28T05:23:08.665Z','ship',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(327,'Chrysler','Weaker variant of the Chrysler vehicle, with all of the same weapons arsenal, but instead of nuclear rounds, it features 2 normal cannon rounds.','legendary',0,'/card-chrysler.png','2026-05-28T05:23:10.052Z','tank',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(328,'Lovebird','Valentine''s reskin of the standard blackbird and Boss Blackbird, featuring the same slow-firing explosive round machine gun and low-damage missiles. The Lovebird''s missiles have a unique flame trail and are adorned with pink skin. The exhaust is also a slightly different shade to match the festive vehicle.','legendary',0,'/card-lovebird.png','2026-05-28T05:23:11.376Z','aircraft',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO cards(id,name,description,rarity,drop_weight,image_url,created_at,card_type,worth_value,burn_value,is_limited_edition,is_event_exclusive,max_copies,total_minted,flavor,droppable,in_packs,is_archived,podium_place) VALUES(329,'Driller','Average ground vehicle with a drill that shots most vehicles, with its most serious damage being around half the health of an exotic ME323. The Driller came out during an Admin Abuse event on February 14th, 2026.','legendary',0,'/card-driller.png','2026-05-28T05:23:12.601Z','tank',500,250,false,false,NULL,0,NULL,true,false,false,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,rarity=EXCLUDED.rarity,drop_weight=EXCLUDED.drop_weight,image_url=CASE WHEN EXCLUDED.image_url='' THEN cards.image_url ELSE EXCLUDED.image_url END,card_type=EXCLUDED.card_type,worth_value=EXCLUDED.worth_value,burn_value=EXCLUDED.burn_value,is_limited_edition=EXCLUDED.is_limited_edition,is_event_exclusive=EXCLUDED.is_event_exclusive,droppable=EXCLUDED.droppable,in_packs=EXCLUDED.in_packs,is_archived=EXCLUDED.is_archived;",
        "INSERT INTO custom_rarities(guild_id,slug,name,emoji,color,position,worth_value,burn_value,drop_weight,droppable,in_packs) VALUES('1363917781355069761','gold_legendary','Gold Legendary','\u2b50',16766720,10,1000,500,2,true,false) ON CONFLICT(guild_id,slug) DO UPDATE SET name=EXCLUDED.name,color=EXCLUDED.color;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',324,'gold_legendary','2026-05-28T05:39:54.287Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',325,'gold_legendary','2026-05-28T05:39:55.620Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',326,'gold_legendary','2026-05-28T05:39:56.954Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',327,'gold_legendary','2026-05-28T05:39:58.120Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',328,'gold_legendary','2026-05-28T05:39:59.560Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO card_rarity_overrides(guild_id,card_id,custom_rarity_slug,created_at) VALUES('1363917781355069761',329,'gold_legendary','2026-05-28T05:40:00.797Z') ON CONFLICT(guild_id,card_id) DO UPDATE SET custom_rarity_slug=EXCLUDED.custom_rarity_slug;",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1037737554641961030',1675,8825,5,4,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1043524302584168522',100,100,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1126547994049777736',120,2120,1,17,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1134860240630853713',150,150,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1148615683698085959',60,60,0,1,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1211353501909786749',2690,2940,1,10,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1300126290917068912',100,100,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1307321587783172148',50,50,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1373692782153175202',800,800,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1391671057168990238',50,50,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1414997389160349706',50,50,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','1438760510832250903',850,850,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','557897922667085836',850,850,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','689063086044348508',200,200,0,0,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','718255146278322206',1490,12740,8,42,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1363917781355069761','767249025438318642',210,2460,2,2,'2026-07-03 06:22:01.233928') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO user_currency(guild_id,user_id,shards,total_earned,packs_opened,cards_burned,updated_at) VALUES('1480402385821110292','1211353501909786749',80,3330,6,10,'2026-05-25 03:11:38.686') ON CONFLICT(guild_id,user_id) DO UPDATE SET shards=GREATEST(user_currency.shards,EXCLUDED.shards),total_earned=GREATEST(user_currency.total_earned,EXCLUDED.total_earned);",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1037737554641961030','first_catch','2026-05-26 10:14:32.182112') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1037737554641961030','legendary_hunter','2026-05-26 10:24:38.695472') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1037737554641961030','rookie','2026-05-26 10:30:27.548509') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1043524302584168522','first_catch','2026-05-26 09:46:08.420259') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1126547994049777736','first_catch','2026-05-26 01:13:35.206908') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1126547994049777736','legendary_hunter','2026-05-26 01:13:35.21386') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1126547994049777736','rookie','2026-05-26 01:14:23.730888') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1134860240630853713','first_catch','2026-05-26 01:54:27.227163') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1134860240630853713','rookie','2026-05-26 01:58:37.664986') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1148615683698085959','first_catch','2026-05-26 02:52:14.856605') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1211353501909786749','first_catch','2026-05-25 22:40:01.538006') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1211353501909786749','legendary_hunter','2026-05-26 09:18:05.997649') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1211353501909786749','rookie','2026-05-26 09:17:56.813753') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1300126290917068912','first_catch','2026-05-26 05:19:11.367367') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1307321587783172148','first_catch','2026-05-26 04:51:34.098685') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1373692782153175202','first_catch','2026-05-26 06:30:49.245958') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1373692782153175202','legendary_hunter','2026-05-26 06:30:49.25782') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1391671057168990238','first_catch','2026-05-26 05:47:00.686802') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1414997389160349706','first_catch','2026-05-26 12:09:11.735609') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1438760510832250903','first_catch','2026-05-26 04:51:01.958078') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','1438760510832250903','legendary_hunter','2026-05-26 04:51:01.969963') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','557897922667085836','first_catch','2026-05-26 01:16:19.857573') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','557897922667085836','legendary_hunter','2026-05-26 01:16:40.865239') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','689063086044348508','first_catch','2026-05-26 02:28:28.549884') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','689063086044348508','rookie','2026-05-26 02:39:30.247406') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','718255146278322206','first_catch','2026-05-26 01:15:47.202822') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','718255146278322206','legendary_hunter','2026-05-26 01:23:39.620133') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','718255146278322206','rookie','2026-05-26 01:34:12.417364') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','767249025438318642','first_catch','2026-05-26 05:09:19.181053') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','767249025438318642','legendary_hunter','2026-05-26 05:14:30.932196') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1363917781355069761','767249025438318642','rookie','2026-05-26 05:15:12.390521') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1480402385821110292','1211353501909786749','first_catch','2026-05-24 03:34:38.840587') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO achievements_unlocked(guild_id,user_id,achievement_key,unlocked_at) VALUES('1480402385821110292','1211353501909786749','rookie','2026-05-24 06:23:31.124502') ON CONFLICT(guild_id,user_id,achievement_key) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','1043524302584168522','2026-05-26 09:55:04.279',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','1300126290917068912','2026-05-26 06:31:56.949',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','1438760510832250903','2026-05-26 04:59:45.8',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','557897922667085836','2026-05-26 01:08:09.521',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','689063086044348508','2026-05-26 02:39:23.83',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','718255146278322206','2026-05-26 01:06:52.097',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1363917781355069761','767249025438318642','2026-05-26 05:07:40.283',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
        "INSERT INTO daily_claims(guild_id,user_id,last_claimed_at,streak) VALUES('1480402385821110292','1211353501909786749','2026-05-24 03:36:06.426',1) ON CONFLICT(guild_id,user_id) DO NOTHING;",
      ];
      for (const _stmt of _dataMigrations) { await client.query(_stmt); }
      // Re-add constraint inside the same transaction — rolled back if any stmt above fails.
      // Constraint was dropped unconditionally above, so always re-add it here.
      await client.query("ALTER TABLE cards ADD CONSTRAINT cards_name_unique UNIQUE (name);");
      await client.query("COMMIT");
      logger.info("Data correction migration applied");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;  // propagate so boot migration failure is logged
    } finally {
      client.release();
    }
  })();

  logger.info("Boot migrations applied");
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // Listen FIRST so the Autoscale startup probe (GET /api/healthz) can respond
  // immediately. Migrations and bot startup happen after the server is ready.
  // Autoscale creates the new instance while the old one is still running;
  // awaiting DDL migrations before listen caused ALTER TABLE to block on
  // the old instance's connections, making the probe time out.
  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        reject(err);
        return;
      }
      logger.info({ port }, "Server listening");
      resolve();
    });
  });

  // Run idempotent boot migrations after the server is accepting traffic.
  // Failures are logged but non-fatal: every statement uses IF NOT EXISTS /
  // conditional guards, so a lock-timeout on a contested table just means the
  // column was already added by a prior deployment.
  runBootMigrations().catch((err) => {
    logger.error({ err }, "Boot migrations failed — server continues");
  });

  // Start Discord bot alongside the API server
  startBot().catch((err) => {
    logger.error({ err }, "Bot startup failed");
  });
}

main();

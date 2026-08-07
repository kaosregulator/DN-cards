# DN Cards

DN Cards is DarkNight's collectible military trading card game for the Roblox + Discord community. Members collect cards through random drops, packs, daily rewards, trading, admin giveaways, and special events. Cards represent military vehicles, ships, aircraft, bosses, community members, and exclusive collectibles.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secret: `DISCORD_BOT_TOKEN` — Discord bot token

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (enums: rarity, card_type, trade_status)
- Discord: discord.js v14
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- DB schema: `lib/db/src/schema/cards.ts` (cards, collections, guilds, packs, daily, achievements, embeds, rarity profiles, custom rarities, dashboard users, card display overrides)
- News schema: `lib/db/src/schema/news.ts`
- Suggestions schema: `lib/db/src/schema/suggestions.ts`
- Sets admin commands: `artifacts/api-server/src/bot/commands/sets-admin.ts` (`/sets_admin`)
- Sets user commands: `artifacts/api-server/src/bot/commands/sets-user.ts` (`/sets`)
- Website-only admin route: `artifacts/api-server/src/routes/admin.ts` (presentation-only — `card_display_overrides` upserts)
- Public roster route (merges overrides): `artifacts/api-server/src/routes/dashboard.ts` `GET /cards`
- News route: `artifacts/api-server/src/routes/news.ts`
- Suggestions route: `artifacts/api-server/src/routes/suggestions.ts`
- Bot entry: `artifacts/api-server/src/bot/index.ts`
- Spawn manager: `artifacts/api-server/src/bot/spawn-manager.ts`
- Admin commands: `artifacts/api-server/src/bot/commands/admin.ts`
- Rarity admin (`/rarity` — profile/custom/card subcommand groups): `artifacts/api-server/src/bot/commands/rarity-admin.ts`
- Embed admin (`/embed` — show/set/reset): `artifacts/api-server/src/bot/commands/embed-admin.ts`
- User commands: `artifacts/api-server/src/bot/commands/user.ts`
- Trading commands: `artifacts/api-server/src/bot/commands/trading.ts`
- Pack store: `artifacts/api-server/src/bot/commands/pack.ts`
- Daily reward + achievements: `artifacts/api-server/src/bot/commands/daily.ts`
- Achievement engine: `artifacts/api-server/src/bot/achievements.ts`
- Wishlist: `artifacts/api-server/src/bot/commands/wishlist.ts`
- Tradein (5→1 upgrade): `artifacts/api-server/src/bot/commands/tradein.ts`
- Visual config panel: `artifacts/api-server/src/bot/commands/config-panel.ts`
- Card/rank data: `artifacts/api-server/src/bot/cards-data.ts`
- DB helpers: `artifacts/api-server/src/bot/db.ts`
- Slash command registration: `artifacts/api-server/src/bot/commands/register.ts`
- Giveaway System schema: `lib/db/src/schema/giveaways.ts` (giveaways, giveaway_entries, giveaway_winners)
- Giveaway System module: `artifacts/api-server/src/bot/giveaway/` (`db.ts` CRUD, `engine.ts` progress+winner draw, `embeds.ts` UI, `manager.ts` message/claim, `command.ts` user, `admin.ts` `/giveaway_admin`, `sweeper.ts` auto-end/reroll, `message-hook.ts` message tracking, `prizes.ts` payout)
- Unified help hub: `artifacts/api-server/src/bot/commands/help-hub.ts` (interactive `/help` — topic dropdown, live-edited pages, animated banner; `/admin_help` opens it on the Admin page). Banner/palette: `artifacts/api-server/src/bot/help-banners.ts`. Rebrandable via `/embed … key:help`.
- Bob (entertainment NPC) schema: `lib/db/src/schema/bob.ts` (bob_settings, bob_profiles, bob_progress)
- Bob module: `artifacts/api-server/src/bot/bob/` (`persona.ts` 3 forms + line banks, `db.ts` coins/xp/stats/leaderboards + opt-in DN reward bridge, `progress.ts` tasks/quests, `games.ts` mini-games, `roulette.ts` roulette+duel, `roast.ts`, `talk.ts` local+optional-Claude, `events.ts` random channel events, `stats.ts`, `menu.ts` hub, `command.ts`/`admin.ts`/`router.ts`)
- Headquarters (HQ) schema: `lib/db/src/schema/headquarters.ts` (player_hq, hq_unlocks, hq_displays, hq_placements, hq_defenders, hq_base_state, hq_base_attacks, hq_base_reigns, hq_world_nodes, hq_terrain)
- Headquarters engine (`/hq`): `artifacts/api-server/src/bot/hq/` — data-driven, theme-agnostic. `defs/{themes,rooms,decorations,walls,floors,backdrops,wallpapers,surfaces,companions,world,unlock-rules}.ts` (registries), `assets.ts` (procedural↔asset seam; resolves `<prefix>/<key>.png` by convention and honours `HQ_ASSETS_DIR`), `db.ts`, `engine.ts` (unlocks DERIVED from existing systems), `grid.ts` (lattice sizes). Hub UI: `artifacts/api-server/src/bot/commands/hq-hub.ts`. See `docs/headquarters.md`.
- HQ renderers: `hq/paint.ts` (shared primitives + header + emoji stripping — the canvas has no emoji font), `hq/render.ts` (isometric room + exterior base + siege), `hq/render-world.ts` (the campaign world map), `hq/render-terrain.ts` (built surfaces, water, hills + the build cursor), `hq/render-wallpaper.ts` (repeating wall coverings in iso perspective), `hq/cinematic.ts` (landscape siege intro GIF).
- HQ world campaign: `hq/world.ts` (seeds `hq_world_nodes` from the `defs/world.ts` blueprint, capture/tribute, AI garrisons synthesised from the guild card pool as real `OwnedBattleCard`s). Six AI factions hold twelve tiered territories per guild; members take them and hold them for tribute.
- HQ world editor: `hq/terrain.ts` (rectangle validation + CRUD), `hq/build-state.ts` (the cursor in `player_hq.stats.build`), `hq/build-options.ts` (slash choices — a leaf module so `register.ts` doesn't pull the hub into startup). Visual editor is `/hq → 🛠️ Build`; the typed half is `/hqbuild` (`artifacts/api-server/src/bot/commands/hq-build.ts`).
- HQ tooling: `pnpm --filter @workspace/scripts run hq:preview` renders every HQ canvas to files; `validate:hq` asserts the registry/blueprint/cursor invariants; `smoke:hq` builds every `/hq` section and checks it against Discord's payload limits (needs `DATABASE_URL`); `hq:manifest` regenerates the art manifest from disk.

### Website vs Discord responsibilities

The website and Discord bot share **one database**, but each owns a distinct slice of it.

**Discord = source of truth for ALL gameplay.** The bot owns every value that
affects spawning, catching, packs, trades, burning, events, and economy:
`cards` (name, rarity, worth, burn, drop weight, image, description, limited
/event flags, max copies, packs/droppable/archived state), `rarity_profiles`,
`custom_rarities`, `card_rarity_overrides`, `embed_overrides`, `guild_settings`,
`card_events`, `collections`, `user_currency`, `trades`, `achievements_unlocked`,
`packs_*`, `daily_*`. Only the bot commands mutate these. The website is
**read-only** against `cards` and never touches the others.

**Website = presentation overrides + its own content.** The website owns:
- `card_display_overrides` — per-card display name/image/description/flavor,
  plus `hidden_from_site`, `featured`, `sort_weight`. Discord never reads it.
- `news_posts`, `suggestions` — website-only content. Discord never reads it.
- `dashboard_users`, `setup_tokens` — website auth.

The old HTTP routes and dashboard pages for per-guild rarity/embed config
(`/api/embeds`, `/api/rarity-profiles`, `/api/custom-rarities`,
`/api/card-rarity-overrides`, and the `/admin/embeds`, `/admin/rarities`,
`/admin/custom-rarities` dashboard pages) have been deleted. All writes to
those tables now happen through Discord slash commands — see
`/rarity` and `/embed` below. The website never reads or writes them.

### Card Display Overrides (Website)
- `/admin` (the "Card Manager" page) edits `card_display_overrides` **only**.
  Gameplay values are shown read-only in a side panel with a "change this in
  Discord" hint.
- Public roster (`/api/cards` via `dashboard.ts`) LEFT JOINs the overrides,
  applies them before responding, filters `hiddenFromSite`, groups by the
  website category override when present, and sorts `featured` →
  `sortWeight` desc → `id` asc.
- Storage: `card_display_overrides` — one row per `cardId` (PK FK→cards.id ON
  DELETE CASCADE). All text override columns are nullable; null = fall back
  to the card's gameplay value. `displayCategory` is website-only grouping
  and does not affect Discord rarity, drops, or inventory. Single global table
  (no `guildId`) because the website is one public showcase.
- API: `GET /api/admin/cards` returns base+override join, `PUT
  /api/admin/cards/:id/display` upserts the override, `DELETE
  /api/admin/cards/:id/display` clears it. Behind `requireDashboardAuth`.
  The router does NOT call the bot's card-cache invalidation because nothing
  on `cards` is mutated.

### News (Website)
- Public: `/news` list, `/news/:slug` detail. Reads `news_posts WHERE
  published_at IS NOT NULL` ordered by `pinned DESC, published_at DESC`.
- Admin: `/admin/news` table + editor. Routes `POST/PATCH/DELETE
  /api/admin/news[/:id]`, `GET /api/admin/news` (includes drafts).
- Storage: `news_posts` (slug UNIQUE, title, bodyMd, imageUrl, pinned,
  publishedAt nullable, authorUserId FK→dashboard_users, timestamps).
- Body is plain text + linebreaks today; markdown rendering can be added
  without a schema change.

### Suggestions (Website)
- Public form at `/suggestions`, no auth. Categories: bug_report,
  card_correction, card_suggestion, event_suggestion, website_feedback.
- Submission protections: honeypot field `website` must be empty; body
  20–4000 chars; max 3 URLs; per-ip-hash rate limit 5/10min and 20/day; 1h
  dedupe on `(ipHash, title)`.
- Privacy: `ipHash = sha256(ip + SESSION_SECRET)` is stored for rate limiting
  only and is **never returned by any API response**. When `anonymous=true`
  the submitter's Discord ID and username are also stripped from admin
  responses. When `anonymous=false` only `submitterDiscordUsername` is
  returned (never the ID).
- Admin: `/admin/suggestions` queue. `GET /api/admin/suggestions[?status=]`,
  `PATCH /api/admin/suggestions/:id` (status + adminNotes). Setting status to
  resolved/rejected/duplicate stamps `resolvedAt` + `resolvedBy`.

### Embed Customization (Dashboard)
- `/admin/embeds` page customizes all 8 bot embeds per guild: spawn, claimed, daily, pack, trade, welcome, rules, commands.
- Knobs per embed: enabled toggle · title · descriptionPrefix · footer · color (or per-rarity colors for spawn/claimed) · imageMode (default/large/thumbnail/none) · customImageUrl · showWorth/showDropChance.
- Tokens in title/footer/prefix: `{user} {username} {card} {rarity} {worth} {chance} {streak} {tier} {amount} {balance} {guild} {channel}`.
- API: `GET/PUT/DELETE /api/embeds/:guildId[/:embedKey]`, behind `requireDashboardAuth`. 60s in-memory cache in the bot, invalidated explicitly on PUT/DELETE.
- Storage: `embed_overrides` table — one row per `(guildId, embedKey)` with a permissive jsonb `config`. Helper `applyEmbedOverride` in `bot/embed-overrides.ts` owns the shape; safe to extend without migration.

### Custom Rarity Tiers (Stage 2)
- `/admin/custom-rarities` lets admins create **brand-new rarity tiers** per guild — beyond the six built-ins — and assign any existing card to them. Server 1 has no rows here so it's completely unaffected.
- Each tier has: slug (URL id), name, emoji, color, **position** (decimal — e.g. `5.5` slots between Epic & Legendary), worth, burn, dropWeight, droppable, inPacks (default false).
- **Replacement, not layering:** a card assigned to a custom tier uses the **tier's** worth/burn/dropWeight — the Stage-1 rarity profile is ignored for that card. One source of truth per card per guild.
- Storage: `custom_rarities` (`(guildId, slug)` unique) and `card_rarity_overrides` (`(guildId, cardId)` unique). Built-in `cards.rarity` is preserved untouched so removing a tier instantly reverts assigned cards.
- API: `GET/PUT/DELETE /api/custom-rarities/:guildId[/:slug]` and `GET/PUT/DELETE /api/card-rarity-overrides/:guildId[/:cardId]`, behind `requireDashboardAuth`.
- Resolver: `getRarityContext(guildId)` returns `{ profile, customBySlug, customByCard }` from a 5s cache. `applyRarityContext(card, ctx)` is THE chokepoint for `worth/burn/dropWeight` — custom override first, then Stage-1 profile, then card's own value. Used by spawn weighting, `/info`, `/list`, `/collection`, `/catalog`, `/burn`, `/pack` pool, `/trade_in` ladder, `/trade` fairness, leaderboard.
- `/pack` excludes custom-tier cards by default (toggle `inPacks` true to opt in). Custom tiers with `droppable=false` are skipped by `pickRandomCard`.
- `/trade_in` ladder is position-ordered: groups user holdings by **effective rarity key** (built-in OR custom slug), so a card moved into a custom tier won't be eligible for the built-in's trade-in chain. The slash command rarity option still only exposes the six built-ins as the FROM tier.
- Deleting a tier also wipes its `card_rarity_overrides` rows (no DB-level FK on slug, done in the route).

### Per-Server Rarity Profiles
- `/admin/rarities` dashboard page lets admins override **worth / burn / drop weight** per-rarity per-guild — without editing individual cards.
- Storage: `rarity_profiles` table — one row per `(guildId, rarity)` with nullable `worthValue` / `burnValue` / `dropWeight`. A null column means "use the card's value".
- API: `GET/PUT/DELETE /api/rarity-profiles/:guildId[/:rarity]`, behind `requireDashboardAuth`. 5s per-guild in-memory cache in the bot, invalidated explicitly on PUT/DELETE.
- Resolver: `getRarityProfile(guildId)` → `RarityProfileMap`; `applyRarityProfile(card, profile)` swaps in the overrides. Used by spawn weighting, `/info`, `/list`, `/pack` (pool + display), `/burn` (via `burnCard`), `/collection`, leaderboard net worth, and trade fairness check.
- **Drop-weight precedence:** profile.dropWeight → guildSettings.rarityWeights → card.dropWeight. So the profile is the strongest knob.
- Servers with no profile rows (e.g. Server 1) are completely unaffected — defaults flow through unchanged.

### Per-Set Rarity Weights (Phase 4)
- Each set has an optional `rarity_weights jsonb` column — partial map of `{ rarity: weight }`. Applies **only when the set is the guild's active set**. Cards' rarity/worth/burn/dropWeight are never touched.
- Admin commands: `/sets_admin setweight set:<s> rarity:<tier> weight:<n>`, `/sets_admin clearweight set:<s> [rarity]`, `/sets_admin showweights set:<s>`.
- Precedence inside `pickRandomCard` (top wins):
  1. custom-tier dropWeight
  2. **active set's rarityWeights[rarity]** ← Phase 4
  3. `rarity_profiles.dropWeight`
  4. `guild_settings.rarityWeights*` (legacy)
  5. `cards.dropWeight`
- `getActiveSetSpawnPoolCached` now returns `{ cards, rarityWeights }` so the spawn path takes one DB read per 5s. Cache invalidated globally on any set-weights write (we don't know which guilds have the set active).
- Partial: tiers the admin doesn't override fall through to the rarity profile / guild defaults. Setting weight `0` *does* disable that tier while the set is active (intentional knob).

### Card Sets (spawn rotation)
- **First-class sets** (`sets` + `card_set_memberships` tables) drive random
  spawns. Each guild picks ONE `activeSetId` on `guild_settings`; random
  spawns pull **exclusively** from that set's droppable cards.
- **Option B (no active set = no random spawns)**: with no active set, or
  with an empty active set, `doSingleSpawn` returns early. Admin `/drop` and
  `/give` bypass the set check (forcedCardId path) — they always work.
- **Command split**:
  - `/sets_admin` (admin) — `create rename delete add remove move bulkadd bulkremove active deactivate view setweight clearweight showweights export exportall showcase`.
  - `/sets` (user, read-only, ephemeral) — `list active view progress`.
- `pickRandomCard(weights, boosts, ctx, availableCards?)` — new 4th param is
  the pre-filtered pool (active set). Old call sites without it fall back to
  the global droppable pool for back-compat.
- Active-set spawn pool is cached 5s per guild via
  `getActiveSetSpawnPoolCached`, invalidated on any set/membership write OR
  `setActiveSet/clearActiveSet`.
- `/mass_drop` filters to the active set when one is selected (falls back to
  the global pool otherwise so testing still works).
- `/info` shows an "Active Set: ✅ / ⚠️ / none" badge so users know whether
  the displayed drop chance can actually fire right now.
- `/event start` warns (doesn't block) when the boosted card isn't in the
  active set — the boost would silently no-op.
- **Phase 7 — `cards.set_name` is gone.** Sets are now tracked exclusively
  via the first-class `sets` + `card_set_memberships` tables. The legacy
  boot-time backfill (`backfillSetsFromLegacy`) is removed. `seedDefaultCards`
  and `loadDefaultCards` join inserted cards directly to the "defaults" set.
  `importCardsFromJson` writes membership rows only.
- **Phase 5 — export/import roundtrip.**
  - `/sets_admin export set:<name>` attaches a single-set JSON (cards + rarity
    weights + `awardsCompletion` flag).
  - `/sets_admin exportall [sets:<a,b>]` attaches a bundle of every set (or a
    subset) in one file.
  - `importCardsFromJson` accepts three shapes: flat (`{cards:[…]}`),
    single-set (`{set:{…}, cards:[…]}`), and bundle (`{sets:[{set,cards}…]}`).
    It restores `rarityWeights` and `awardsCompletion` per set. Numeric
    fields on cards (worth/burn/dropWeight) are preferred over
    description-string scraping.
- **Phase 6 — set-completion achievements.**
  - Static: `set_first_complete` (1 set, +500 💠), `set_collector` (3 sets,
    +1500 💠), `set_master` (5 sets, +4000 💠) — fire across ALL sets the
    user has finished, regardless of any per-set flag.
  - Dynamic: `set_complete:<setId>` (+1000 💠) — only sets whose admin
    toggled `awardsCompletion=true` via `/sets_admin showcase` award their
    own dedicated achievement. "Completion" = own every card in the set
    (collections row exists; shinies irrelevant).
- Legacy `/loadset`, `/listsets`, `/unloadset` have been merged into
  `/sets_admin load/unload/listloaded` for easier discovery. `/sets_admin unload`
  is destructive (deletes cards), `/sets_admin delete` only removes memberships.

### Limited-Time Events
- `/event start card:<Name> duration:<30m|2h|1d> [multiplier:<1.1–50>]` — boost a card's effective spawn weight. Max 14d duration, default 2× multiplier.
- `/event list` — show all active events (with end time + remaining).
- `/event stop id:<ID>` — end an event early.
- Boost is applied AFTER the rarity-tier weight override (so admins can promote a single card above its tier baseline). Stacking events on the same card multiplies their boosts.
- Activations and stops are announced (best-effort) in the configured spawn channel.

### Trade Fairness Warning
- When the proposing side's worth ratio vs the requesting side exceeds **3:1** (cards by `worthValue`, shards 1:1), the trade embed shows an orange ⚠️ banner naming the disadvantaged party. Trade still goes through if accepted — it's informational only.

### Unified Help Hub
- `/help` (and `!help`) open one interactive, ephemeral help message: an animated banner + a **topic dropdown** (Overview, Collecting, Economy, Trading & Market, Battles/Raids/Squads, Giveaways, Quests & Reputation, Echo & AFK, Admin). Picking a topic **live-edits** the same message — no new messages. `/admin_help` opens it on the Admin page (admin-gated). It documents every player and admin command in one place.
- The embed is admin-rebrandable through the existing override system: `/embed set key:help field:customImageUrl|color|title|footer value:<…>` (the `help` key was added to `EMBED_KEYS`). Banner + section palette live in `help-banners.ts`; the banner is a free direct-hotlink animated GIF and swappable per guild.
- Custom-IDs are namespaced `help:*` (select `help:select`, button `help:home`) and routed in `index.ts`.

### Bob — Entertainment NPC (add-on)
- A self-contained fun module with its **own** currency (🪙 Bob Coins), XP/levels, stats, tasks, quests, and cosmetic titles. It never touches the DN Cards card/collection/currency tables. Three per-guild tables (`bob_settings`, `bob_profiles`, `bob_progress`); live games run in memory.
- **Three forms** rolled per interaction: 🟡 Normal, 🔵 Blue (evil, ~12%, doubles win rewards / hard-mode roulette), 🙃 Upside-Down (glitched, ~2%, may invert outcomes). Odds are admin-tunable.
- **Games:** `/bob_roulette` (animated survival, gentle losses — never below 0 coins, survival streak), `/bob_duel` (turn-based, first BANG loses), plus Coin Flip, Dice, Higher/Lower, Slots, Lucky Wheel, Guess-the-Emoji in the `/bob` hub — all animated, cooldown-gated, with rewards + stats.
- **Roast** (`/bob_roast`, form-flavoured banks, cooldown anti-spam), **Talk** (`/bob_talk` — local personality by default; upgrades to Claude when `bob_admin toggle ai on` AND `ANTHROPIC_API_KEY` is set; keeps short per-user memory), **Tasks** (daily) + **Quests** (long-term) that pay coins/XP/titles, and random **channel events** ("BOB HAS ARRIVED" — first-click / trivia / mystery box) that only fire in admin-configured channels.
- **Stats & leaderboards:** `/bob_stats`, `/bob_leaderboard` (richest, most wins, best roulette streak, most interactions, biggest gamblers, jackpot kings, highest level).
- **Commands:** `/bob` (hub), `/bob_roulette`, `/bob_duel`, `/bob_roast`, `/bob_talk`, `/bob_stats`, `/bob_leaderboard`, admin `/bob_admin settings|toggle|odds|rewards|cooldown|channels|testevent`. All component IDs namespaced `bob:*` and routed in `bob/router.ts`.
- **Optional DN Cards bridge:** `bob_admin toggle dex on` lets rare Bob events pay real DN Shards/packs via the existing grant paths — the only crossover. New tables need `pnpm -C lib/db run push`.

### Giveaway System (add-on)
- Purely additive feature powered by DN Cards. Admins run giveaways with custom prizes; players earn chances through real gameplay. Three per-guild tables (`giveaways`, `giveaway_entries`, `giveaway_winners`); nothing in the core card/battle/raid/echo tables is modified.
- **Prizes** (any mix): `shards`, `pack` (basic/premium/legendary ×N), `card:<Name> xN` (minted via the real `catchCard` path), `nitro`, `role` (auto-assigned on claim), `custom`. Card/pack/shard prizes auto-fulfil through the existing economy; nitro/custom produce an admin hand-off receipt.
- **Requirements** measure activity from when the giveaway goes active, fed by fire-and-forget hooks on the SAME flows quests use: `catch` (rarity-gatable), `burn`, `pack_open`, `battle_win`, `battle_played` (valid, non-forfeit), `raid_join`, `raid_damage`, `echo_use`, `message` (anti-spam: bots/commands ignored, one counted msg per member per 12s).
- **Winner modes:** `entry` (weighted random by earned 🎟️ entries — `*N` per unit, `+N` on completion) or `completion` (must finish every requirement). **Difficulty:** easy/medium/hard/legendary (cosmetic tier + color).
- **UI (raid-style):** one channel message updates in place while entrants join, then the SAME message is edited into a winner announcement with a **Claim Prize** button. Buttons: My Progress / Enter (open giveaways) / Details / Claim. Times use Discord `<t:unix:…>` so every viewer sees their local timezone with no stored preference.
- **Claim + reroll:** winners claim within `claimTimerMinutes` (default 24h); the minute sweeper (`giveaway/sweeper.ts`) auto-ends due giveaways, draws winners, and rerolls unclaimed slots. Admins can `/giveaway_admin reroll`. Announce via channel / DM / both.
- **Commands:** `/giveaways` (board + your standing), `/giveaway progress [id]`, and admin `/giveaway_admin create|edit|end|winners|list|reroll`. Create uses compact syntax, e.g. `prizes: shards:50000; nitro:1 Month Nitro; card:Dragon Lord x10` and `requirements: catch:50:*1; battlewin:10:+10; message:100`.
- **DB push:** new tables require `pnpm -C lib/db run push` after deploy.

## Architecture decisions

- Bot runs inside the same Express server process (startBot() called from index.ts) — keeps infra simple, one workflow to manage.
- **Command split:** Setup/config commands use `!` prefix (text commands). Quick admin actions + all user commands use slash commands.
- **Flat slash commands:** every command is a standalone top-level command (`/burn`, `/daily`, `/drop`, `/setup`) — NOT nested under `/cards …` / `/admin …` hubs. `register.ts` `buildCommands()` returns them flat; `index.ts` routes each name via the exported `USER_HUB_COMMANDS` / `ADMIN_HUB_COMMANDS` sets to `handleUserCommand` / `handleAdminCommand`. The category grouping players see lives in the `/help` hub, not the slash menu. ~67 commands total (under Discord's 100/guild cap).
- Weighted random card drops: each card has a `dropWeight`; guild-specific rarity weights override per-rarity (stored as nullable ints in guild_settings).
- Multi-card spawns: `cardsPerSpawn` (1/3/5/-1=random) fires N independent spawn events with 5s gaps. `activeSpawns` is `Map<guildId, Map<spawnId, ActiveSpawn>>` to support multiple simultaneous spawns.
- Catch detection: any non-`!` message is checked against ALL active spawns for the guild (case-insensitive).
- Server owner + Discord Administrators always have admin access; additional bot admins stored in DB.
- Collector rank is based on unique cards owned (9 ranks: Recruit → Dark Commander).
- Net worth = sum of (worthValue × count) across all owned cards — used for leaderboard ranking.
- Trading is a propose/accept flow: initiator creates a DB record, target accepts/declines with the trade ID. Trades can be cards-only, shards-only, or mixed.
- Limited Edition cards have maxCopies; once totalMinted hits the cap, they cannot spawn. Admin-drop only.
- Event Exclusive cards are droppable=false and dropWeight=0 — never appear in random draws, admin-drop only.
- Burn system: destroys one copy, awards burnValue shards to user's DN Shards balance.
- `!setup` wizard: interactive multi-step setup — choose_type → channel → cooldown_number → cooldown_unit → cards_per_spawn → rarity_choice → (5 rarity steps) → test_card. Sessions stored in memory per `guildId:userId`, 5-min timeout.
- **Pack store atomic claim:** `/pack` open is a single conditional UPDATE that enforces shards ≥ cost, shared cooldown, and per-tier weekly cap (with Monday 00:00 UTC rollover applied inline via CASE). Zero rows = no state change; caller re-reads the row to explain why. Prevents TOCTOU races across concurrent opens. Failed-grant path calls `refundClaim()` to roll back shards + counters.
- **Daily atomic claim:** `/daily` uses `INSERT … ON CONFLICT DO NOTHING` for first-time, then a cooldown-gated UPDATE for repeats. Streak resets via SQL CASE when last claim > 48h ago.
- **Achievements** unlock check fires after catches, /burn, /pack, /trade-accept, /daily, /trade_in. Stored in `achievements_unlocked` with a unique (guild, user, key) index so the insert is idempotent.
- **Shinies** are a separate `shinyCount` column on `collections` (not a flag on individual rows) — keeps the (guild, user, card) unique index intact while letting us count shinies once at SHINY_MULTIPLIER for net worth and leaderboard. `catchCard` rolls SHINY_RATE bot-side then UPSERTs the right counter; `burnCard({shiny:true})` decrements `shinyCount` specifically so `/burn name:X all:true` can't accidentally torch rare shinies.
- **Event boosts** are read once per spawn via `getActiveEventBoosts(guildId)` (joined-and-filtered by `endsAt > NOW()`) and passed as `Map<cardId, multiplier>` into `pickRandomCard`. Stopping an event is just `UPDATE … SET endsAt = NOW()` so expired rows stay around as history.

## Product

### Card Acquisition
- **Random drops**: Cards spawn at configured intervals in the spawn channel
- **Card packs**: `/pack tier:basic|premium|legendary` — buy with DN Shards, opens 5 cards
- **Daily reward**: `/daily` for shards with a 7-day streak bonus
- **Event drops**: Admin force-drops specific cards with `/drop name:<Name>`
- **Limited-time events**: `/event start|list|stop` — admin boosts any card's spawn weight for a duration
- **Admin giveaways**: `/give user:@User name:<Card Name>` — direct award (no shiny roll)
- **Trading**: `/trade user:@User offer:<card>|shards want:<card>|shards` (shows ⚠️ if value ratio > 3:1)
- **Trade-in**: `/trade_in <rarity>` — burn 5 of one rarity for 1 random card of the next tier up
- **Wishlists**: `/wishlist` — get pinged when wished-for cards spawn
- **Shinies ✨**: every random/pack/tradein acquisition has a flat 0.5% chance to mint a shiny. Shiny copies count at 2× worth/burn, are tracked separately, and are **not tradeable** in v1.

### Card System
- **6 rarities**: Common (weight 60), Uncommon (25), Rare (10), Epic (4), Legendary (1), **Mythic** (0 — admin-only by default)
- **Worth values**: Common 10 → Legendary 2500 → Mythic 6000 DN Shards
- **Burn values**: Common 5 → Legendary 1250 → Mythic 3000 DN Shards (50% of worth)
- **Mythic tier**: the new top rarity. Default weight 0 (never drops randomly until admins set a weight or run an `/event`). Appears in **Legendary** packs at 0.5% by default. Trade-in: Legendary → Mythic (5 Legendaries for 1 Mythic).
- **`/rarityname`** (admin) — rename the Mythic tier per-server (e.g. "Prismatic", "Apex") with a custom emoji and hex color. Use `/rarityname reset:true` to revert.
- **Limited Edition**: Admin-created, capped at a set number of copies (4× worth/burn)
- **Event Exclusive**: Admin-drop only, never appear in random spawns (3× worth/burn)
- **Card Types**: tank, aircraft, ship, vehicle, infantry, boss, community, event, achievement, limited

### Pack Store (3 tiers)
| Tier | Default Cost | Cards | Weekly Cap | Special |
|---|---|---|---|---|
| 🥉 Basic | 250 💠 | 5 | 50/week | Standard rates (60/25/11/3.5/0.5) |
| 🥈 Premium | 750 💠 | 5 | 20/week | Boosted rare/epic, 6× legendary chance |
| 🥇 Legendary | 2,000 💠 | 5 | 5/week | **No commons**, 20× legendary chance |

- Defaults are EV-tuned (~5% house edge vs. average card worth).
- **Shared cooldown** across all tiers (default 60s, configurable).
- **Separate per-tier weekly caps** — hit Legendary cap, you can still open Basics.
- **Weekly reset**: Monday 00:00 UTC for all three buckets.
- All four knobs (cost / size / cap / shared cooldown) configurable per server via `/config → 🎴 Packs`.
- Use `/pack_stats` to see your per-tier usage, cooldown remaining, and reset countdown.

### Economy (DN Shards 💠)
- **Earned by**: burning duplicate cards (`/burn`), `/daily` rewards (50 base + streak bonus up to +200), gifts (`/gift`), trade-in upgrades, admin awards (`/give_shards`), achievement unlocks
- **Spent on**: `/pack` openings, `/trade` offers, `/gift` to other members
- Balance + all-time-earned tracked per user per guild
- Admins can deduct with `/take_shards`

### Daily Reward
- 20h cooldown (slight grace so dailies don't drift later each day)
- 48h grace before streak resets to 1
- Base 50 💠 + (streak − 1) × 10, capped at +200 bonus
- 7-day streak unlocks the "Devotee" achievement (+1000 💠)

### Achievements (10 unlockable)
Auto-unlock with a shard reward and ephemeral notification on the triggering action.
- 🎣 First Catch (50) · 📦 Rookie 10 unique (100) · 💼 Elite 50 (500) · 🏆 Master 100 (1500)
- 🌟 Legendary Hunter — own ≥1 Legendary (750) · 👑 Sovereign — own every Legendary (5000)
- 🔥 Pyromaniac — burn 50 (500) · 🤝 Diplomat — first trade (200)
- 🎴 Pack Addict — open 10 packs (1000) · 📅 Devotee — 7-day daily streak (1000)

### Collector Progression (9 ranks)
| Rank | Emoji | Unique Cards Needed |
|---|---|---|
| Recruit | 🪖 | 0 |
| Private | ⭐ | 5 |
| Corporal | ⭐⭐ | 15 |
| Sergeant | 🎖️ | 30 |
| Lieutenant | 🔰 | 50 |
| Captain | 🏅 | 75 |
| Colonel | 🌟 | 100 |
| General | 💎 | 150 |
| Dark Commander | 👑 | 200 |

### Default Card Roster (27 cards)
Seeded on first boot. All military-themed.
- 8 Common: M4 Sherman, Jeep Willys, Dog Tags, M1 Helmet, Radio Set, Supply Truck, Recon Drone, Sandbag Bunker
- 6 Uncommon: M1 Abrams, AH-64 Apache, USS Arleigh Burke, F-16 Fighting Falcon, Bradley IFV, T-80 Objekat
- 6 Rare: F-22 Raptor, USS Nimitz, Leopard 2A7, T-14 Armata, B-2 Spirit, USS Virginia
- 4 Epic: SR-71 Blackbird, USS Gerald R. Ford, F-35 Lightning II, Night Stalker
- 3 Legendary: Darknight Titan, Operation Zero, The Warlord

## Gotchas

- The bot requires `MESSAGE_CONTENT` intent — enable in Discord Developer Portal (Bot → Privileged Gateway Intents).
- The bot requires `SERVER MEMBERS` intent — also enable in the portal.
- After changing the DB schema, always run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs` to regenerate types before building.
- DB enums (rarity, card_type, trade_status) require `push-force` if enum values change.
- Slash commands are registered globally + per-guild on every restart. Guild commands take effect instantly; global propagation can take up to 1h on first deploy.
- Bot invite must include `applications.commands` scope so slash commands appear in the server.
- Card images for `!addcard`, `!addlimited`, `!addevent` are added via URL only (no attachment support in prefix commands). For guaranteed permanence use Imgur or similar; Discord CDN URLs are stable as long as the source message exists.
- Discord caps: 5 components per ActionRow, 5 rows per message, 4096 chars per embed description, 1024 chars per embed field value, 25 fields per embed — all enforced or budgeted in the codebase.
- `user_currency` has no unique `(guildId, userId)` index — preexisting. Race-only risk on a user's first-ever currency-creating action; new pack code uses atomic UPDATE which is safe once a row exists.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

- Pack tier naming: **Basic / Premium / Legendary** (chosen May 2026)
- Weekly caps: **separate per tier** (not shared)
- Pack cooldown: **shared across all tiers**
- Default pricing: **EV-fair** (~5–10% house edge)

## Bot Commands Reference

Card catching is text-based — when a card spawns, type its name exactly to catch it.

### User Slash Commands
| Command | Description |
|---|---|
| `/welcome` | Posts the public Welcome / Rules / Commands intro (3 banner-led embeds) |
| `/help` | Full command reference |
| `/collection [user]` | Paginated collection with rank, net worth, achievements summary |
| `/rank [user]` | Collector rank and progression |
| `/info name:<Name>` | Card details, worth, burn value, drop chance |
| `/list` | Full roster grouped by rarity |
| `/catalog` | Browse cards by category — see what you own and what's missing |
| `/top` | Top 10 net-worth leaderboard + top 5 pack openers |
| `/burn name:<Name> [shiny:true]` | Burn a card for DN Shards (shiny:true burns shiny pile at 2× value) |
| `/shards [user]` | Check shard balance |
| `/daily` | Claim daily shards (with streak bonus) |
| `/pack tier:<basic\|premium\|legendary>` | Open a pack |
| `/pack_stats` | Your pack costs, weekly caps, cooldown |
| `/trade_in rarity:<r>` | Burn 5 of one rarity for 1 random card of the next tier |
| `/wishlist` | Manage your wishlist — get pinged on spawn |
| `/achievements [user]` | View unlocked achievements |
| `/trade user:@User offer want` | Propose a trade (cards, shards, or both) |
| `/gift user:@User amount:<n>` | Gift shards to another member |
| `/trades` | View pending trade offers |
| `/trade_history [user]` | Recent completed trades, newest first |
| `/accept id:<ID>` | Accept a trade |
| `/decline id:<ID>` | Decline or cancel a trade |
| `/giveaways` | Active giveaways: prizes, live countdown, requirements, your progress + entries |
| `/giveaway progress [id]` | Detailed per-requirement progress and earned entries |
| `/bob` | Open Bob — games, roulette, roasts, tasks, quests, talk, stats |
| `/bob_roulette` · `/bob_duel` · `/bob_roast` · `/bob_talk` · `/bob_stats` · `/bob_leaderboard` | Bob entertainment commands |

### Admin Quick Actions (Slash Commands)
| Command | Description |
|---|---|
| `/config` | Visual config panel (toggles, intervals, rates, packs sub-panel) |
| `/admin_hub` | Ephemeral admin hub — manage bot admins, catch timeouts, set channels, server state |
| `/admin_help` | Show admin & setup command reference |
| `/drop [name:<Name>]` | Force-drop a card for events/giveaways |
| `/mass_drop` | Drop a big batch of cards — mostly low tier with a few bangers |
| `/give user:@User name:<Name>` | Give a card directly to a member |
| `/give_shards user:@User amount:<n>` | Give DN Shards to a member |
| `/take_back user:@User name:<Name>` | Remove a card from a member |
| `/take_shards user:@User amount:<n>` | Deduct DN Shards from a member |
| `/event start card:<Name> duration:<e.g. 2h> [multiplier:<n>]` | Start a limited-time spawn boost |
| `/event list` | Show all active events |
| `/event stop id:<ID>` | End an event early |
| `/giveaway_admin create title duration prizes [requirements] [winners] [difficulty] [mode] [channel] [image] [claimtimer] [announce]` | Create & launch a giveaway (compact prize/requirement syntax) |
| `/giveaway_admin edit id [fields…]` | Edit any field of a giveaway; refreshes the live message |
| `/giveaway_admin end id` | End a giveaway now and draw winners |
| `/giveaway_admin winners id` | View winners and claim status |
| `/giveaway_admin list` | Active + past giveaways |
| `/giveaway_admin reroll id [user]` | Reroll a winner (auto-picks a fresh eligible player) |
| `/rarityname name:<Name> emoji:<🔮> [color:<#hex>] [reset:true]` | Customize the Mythic tier's display name, emoji & color |
| `/rarity profile set rarity:<tier> [worth] [burn] [weight]` | Override worth/burn/drop-weight for a built-in rarity |
| `/rarity profile reset rarity:<tier>` | Clear all overrides for a built-in rarity |
| `/rarity profile list` | Show current per-tier overrides |
| `/rarity custom add\|edit\|remove\|list` | Manage brand-new rarity tiers beyond the 6 built-ins |
| `/rarity card assign card:<Name> slug:<tier>` | Put a card into a custom tier (replaces its worth/burn/weight) |
| `/rarity card unassign card:<Name>` | Revert a card to its built-in rarity |
| `/embed show key:<embed>` | Show current per-guild override for an embed |
| `/embed set key:<embed> field:<field> value:<v>` | Set one field on an embed override (color, title, footer, image, etc.) |
| `/embed reset key:<embed> [field]` | Reset one field or the whole embed override |
| `/sets_admin load file:<.json> [name:<set>]` | Import cards from a JSON file (creates or appends to a set) |
| `/sets_admin unload set:<Name>` | Nuke a set and all its cards (destructive) |
| `/sets_admin listloaded` | List all sets with card counts |

### Setup & Config Commands (`!` prefix — admin only)
| Command | Description |
|---|---|
| `!setup` | Interactive setup wizard (channel → interval → cards per drop → rarity → test card) |
| `!setchannel #channel` | Set spawn channel |
| `!setinterval <time>` | Fixed interval (e.g. `30m`, `1h`, `2h`) |
| `!setinterval random <min> <max>` | Random interval range (e.g. `10m 60m`) |
| `!setwindow <time>` | Catch window duration |
| `!setdrops 1\|3\|5\|random` | Cards per spawn batch |
| `!setrarity <rarity> <weight>` | Customize drop weight for a rarity tier |
| `!spawnenable` / `!spawndisable` | Toggle auto-spawning |
| `!tradingenable` / `!tradingdisable` | Toggle trading |
| `!settradechannel #channel` | Set dedicated trade channel |
| `!addcard <rarity> <Name> \| <desc>` | Add a standard card |
| `!addlimited <rarity> <maxcopies> <Name> \| <desc>` | Add limited edition card |
| `!addevent <rarity> <Name> \| <desc>` | Add event exclusive card |
| `!removecard <Name>` | Remove a card from the pool |
| `!addadmin @User` | Grant bot admin access |
| `!removeadmin @User` | Revoke bot admin access |
| `!listadmins` | List bot admins |
| `!settings` | View current server configuration |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

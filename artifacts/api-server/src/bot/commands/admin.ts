import { MessageFlags, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import {
  isAdmin, getAllCards, addShards, catchCard, getOrCreateGuildSettings,
  removeCardFromUser, deductShards,
} from "../db.js";
import { spawnCard, scheduleNextSpawn } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_LABELS, type Rarity } from "../cards-data.js";
import { logger } from "../../lib/logger.js";
import { handleConfigCommand } from "./config-panel.js";
import { handleAdminHubCommand } from "./admin-hub.js";
import { handleEventCommand } from "./event.js";
import { handleSetChannels } from "./setchannels.js";
import { EmbedBuilder } from "discord.js";

// ── /adminhelp — admin/setup command reference ───────────────────────────────
async function handleAdminHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!(await checkAdmin(interaction))) {
    await interaction.editReply("❌ Admins only.");
    return;
  }
  const embed = new EmbedBuilder()
    .setTitle("🛠️ DN Cards — Admin Reference")
    .setColor(0xeb459e)
    .setDescription(
      "All commands here are admin-gated. Player commands are in `/help`.\n" +
      "Most actions are also reachable visually from `!setup` or `/config`.",
    )
    .addFields(
      {
        name: "⚙️ Setup & Config",
        value:
          "`!setup` — **interactive setup panel** (recommended)\n" +
          "`/config` — open the config panel anytime (catch mode, intervals, toggles, rates)\n" +
          "`/setchannels` — pick spawn/trade channels from a dropdown (no `#` typing)\n" +
          "`/adminhub` — manage bot admins & catch timeouts\n" +
          "`!settings` — text dump of current configuration",
      },
      {
        name: "📢 Channels & Toggles *(`!` prefix)*",
        value:
          "`!setchannel #channel` · `!settradechannel #channel`\n" +
          "`!setinterval <time>` · `!setinterval random <min> <max>` · `!setwindow <time>`\n" +
          "`!setdrops <1|3|5|random>` · `!setcatchmode <type|button|both>`\n" +
          "`!setrarity <rarity> <weight>`\n" +
          "`!spawnenable` / `!spawndisable` · `!tradingenable` / `!tradingdisable`",
      },
      {
        name: "🃏 Card Management *(`!` prefix)*",
        value:
          "`!addcard` · `!addlimited` · `!addevent` — guided card creation wizards\n" +
          "`!editcard <Name>` · `!removecard <Name>`\n" +
          "`!import` — bulk import cards from JSON attachment",
      },
      {
        name: "⚡ Live Actions *(slash)*",
        value:
          "`/drop [name]` — force a single drop\n" +
          "`/massdrop [amount]` — drop 10-25 cards in a batch *(event use)*\n" +
          "`/give user:@Member name:<card>` · `/takeback user:@Member name:<card>`\n" +
          "`/giveshards user:@Member amount:<n>` · `/takeshards user:@Member amount:<n>`",
      },
      {
        name: "🎯 Limited-Time Events *(slash)*",
        value:
          "`/event start card:<Name> duration:<30m|2h|1d> [multiplier:<1.1–50>]` — boost a card's spawn weight (default 2×, max 14d)\n" +
          "`/event list` — show active events + remaining time\n" +
          "`/event stop id:<n>` — end an event early\n" +
          "*Activations/stops are announced in the spawn channel.*",
      },
      {
        name: "🗂️ Card Sets *(slash)*",
        value:
          "`/loadset file:<.json>` — upload a custom card pack\n" +
          "`/listsets` — see all loaded sets · `/unloadset set:<name>` — remove a set\n" +
          "*Built-in starter roster is opt-in via the `!setup` panel.*",
      },
      {
        name: "👥 Admins *(`!` prefix)*",
        value:
          "`!addadmin @User` · `!removeadmin @User` · `!listadmins`\n" +
          "Server owner + Discord Administrators are always admins.",
      },
    );
  await interaction.editReply({ embeds: [embed] });
}

// ── Permission check ──────────────────────────────────────────────────────────
async function checkAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const member = interaction.member as GuildMember | null;
  if (member?.permissions.has("Administrator")) return true;
  return isAdmin(interaction.guild.id, interaction.user.id);
}

// ── Quick admin slash command handler ─────────────────────────────────────────
export async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  cmd: string,
): Promise<void> {
  if (!interaction.guild) return;

  // /config opens an ephemeral panel — it handles its own reply (no defer).
  if (cmd === "config") {
    await handleConfigCommand(interaction);
    return;
  }
  if (cmd === "adminhub") {
    await handleAdminHubCommand(interaction);
    return;
  }
  if (cmd === "adminhelp") {
    await handleAdminHelp(interaction);
    return;
  }
  // /setchannels manages its own reply (interactive multi-step picker).
  if (cmd === "setchannels") {
    await handleSetChannels(interaction);
    return;
  }

  // All admin replies are ephemeral — only the staff member running the
  // command sees the confirmation. The side effects (card drops, etc.)
  // are already broadcast publicly through their own messages.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ok = await checkAdmin(interaction);
  if (!ok) {
    await interaction.editReply("❌ You don't have permission to use admin commands.");
    return;
  }

  const guildId = interaction.guild.id;
  const opts = interaction.options;

  // ── /event start|list|stop ────────────────────────────────────────────────
  // Delegated to event.ts. We've already deferred + admin-checked above so
  // it can go straight to editReply.
  if (cmd === "event") {
    await handleEventCommand(interaction);
    return;
  }

  // ── /drop ─────────────────────────────────────────────────────────────────
  if (cmd === "drop") {
    const cardName = opts.getString("name");
    const settings = await getOrCreateGuildSettings(guildId);
    if (!settings.spawnChannelId) {
      await interaction.editReply("❌ No spawn channel set. Run `!setchannel #channel` first.");
      return;
    }
    let forcedCardId: number | undefined;
    if (cardName) {
      const cards = await getAllCards();
      const found = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!found) { await interaction.editReply(`❌ Card "**${cardName}**" not found. Try \`/list\`.`); return; }
      forcedCardId = found.id;
    }
    await spawnCard(guildId, forcedCardId, true);
    await interaction.editReply(forcedCardId ? `✅ Force-dropped **${cardName}**!` : "✅ Dropped a random card!");
    scheduleNextSpawn(guildId);
    return;
  }

  // ── /massdrop ─────────────────────────────────────────────────────────────
  // "Admin abuse" — a chaotic event batch tilted heavily toward low rarities
  // with guaranteed mid-tier and one legendary banger. Fires sequentially with
  // a small gap so Discord doesn't rate-limit and so the channel reads as a
  // dramatic event rather than a wall of embeds.
  if (cmd === "massdrop") {
    const amount = opts.getInteger("amount") ?? 15;
    const settings = await getOrCreateGuildSettings(guildId);
    if (!settings.spawnChannelId) {
      await interaction.editReply("❌ No spawn channel set. Run `!setchannel #channel` first.");
      return;
    }
    const allCards = await getAllCards();
    const pool = allCards.filter(c => c.droppable && !c.isArchived && (!c.maxCopies || c.totalMinted < c.maxCopies));
    const byRarity: Record<Rarity, typeof pool> = { common: [], uncommon: [], rare: [], epic: [], legendary: [] };
    for (const c of pool) byRarity[c.rarity as Rarity].push(c);

    // Distribution: 1 legendary banger, 1 epic, ~2 rare, ~30% uncommon, rest common.
    const target = computeMassDropDistribution(amount);
    const pick = (r: Rarity): typeof pool[number] | null => {
      const bucket = byRarity[r];
      if (bucket.length === 0) return null;
      return bucket[Math.floor(Math.random() * bucket.length)] ?? null;
    };
    // Build the queue, falling back down the rarity ladder if a tier is empty.
    const ladder: Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];
    const queue: typeof pool = [];
    for (const r of ladder) {
      for (let i = 0; i < target[r]; i++) {
        let picked: typeof pool[number] | null = null;
        for (let li = ladder.indexOf(r); li < ladder.length && !picked; li++) picked = pick(ladder[li]!);
        for (let li = ladder.indexOf(r) - 1; li >= 0 && !picked; li--) picked = pick(ladder[li]!);
        if (picked) queue.push(picked);
      }
    }
    if (queue.length === 0) {
      await interaction.editReply("❌ No droppable cards available to mass-drop.");
      return;
    }
    // Shuffle so the legendary isn't always first — keeps the chaos fresh.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j]!, queue[i]!];
    }

    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (const c of queue) counts[c.rarity as Rarity]++;
    const summary = ladder
      .filter(r => counts[r] > 0)
      .map(r => `${RARITY_EMOJI[r]} ×${counts[r]}`)
      .join(" · ");

    await interaction.editReply(
      `💥 **Admin abuse engaged.** Dropping **${queue.length}** cards over ~${Math.round(queue.length * 5)}s.\n${summary}`,
    );

    // Fire the spawns in the background — don't await, so we can return the
    // ephemeral confirmation immediately. Errors are logged, not re-thrown.
    void (async () => {
      for (let i = 0; i < queue.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 5000));
        try {
          await spawnCard(guildId, queue[i]!.id, true);
        } catch (err) {
          logger.warn({ err, cardId: queue[i]!.id }, "massdrop spawn failed");
        }
      }
      scheduleNextSpawn(guildId);
    })();
    return;
  }

  // ── /give ─────────────────────────────────────────────────────────────────
  if (cmd === "give") {
    const target = opts.getUser("user", true);
    const cardName = opts.getString("name", true);
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) { await interaction.editReply(`❌ Card "**${cardName}**" not found.`); return; }
    // Admin gives are deterministic — no shiny roll. Use /event or normal
    // drops if you want shiny chances.
    await catchCard(guildId, target.id, card.id, { noShiny: true });
    const r = card.rarity as Rarity;
    await interaction.editReply(`✅ Gave **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}) to <@${target.id}>.`);
    return;
  }

  // ── /giveshards ───────────────────────────────────────────────────────────
  if (cmd === "giveshards") {
    const target = opts.getUser("user", true);
    const amount = opts.getInteger("amount", true);
    await addShards(guildId, target.id, amount);
    await interaction.editReply(`✅ Gave <@${target.id}> 💠 **${amount.toLocaleString()} shards**.`);
    return;
  }

  // ── /takeback ─────────────────────────────────────────────────────────────
  if (cmd === "takeback") {
    const target = opts.getUser("user", true);
    const cardName = opts.getString("name", true);
    const cards = await getAllCards();
    const card = cards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
    if (!card) { await interaction.editReply(`❌ Card "**${cardName}**" not found.`); return; }
    const result = await removeCardFromUser(guildId, target.id, card.id);
    if (!result.success) {
      await interaction.editReply(`❌ <@${target.id}> doesn't have **${card.name}**.`);
      return;
    }
    const r = card.rarity as Rarity;
    await interaction.editReply(
      `✅ Removed **${card.name}** (${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}) from <@${target.id}>.` +
      (result.remaining > 0 ? ` They still have ×${result.remaining}.` : " Last copy removed."),
    );
    return;
  }

  // ── /takeshards ───────────────────────────────────────────────────────────
  if (cmd === "takeshards") {
    const target = opts.getUser("user", true);
    const amount = opts.getInteger("amount", true);
    const result = await deductShards(guildId, target.id, amount);
    if (!result.success) {
      await interaction.editReply(`❌ <@${target.id}> has no shards to deduct.`);
      return;
    }
    await interaction.editReply(
      `✅ Deducted 💠 **${amount.toLocaleString()} shards** from <@${target.id}>. New balance: **${result.remaining.toLocaleString()}**.`,
    );
    return;
  }

  await interaction.editReply("❌ Unknown command.");
}

// Mass-drop rarity distribution: 1 legendary banger, 1 epic, ~2 rare,
// ~30% uncommon, the rest common. Tuned for 10-25 amounts.
function computeMassDropDistribution(amount: number): Record<Rarity, number> {
  const legendary = 1;
  const epic = 1;
  const rare = Math.max(2, Math.floor(amount * 0.13));
  const uncommon = Math.max(2, Math.floor(amount * 0.30));
  const used = legendary + epic + rare + uncommon;
  const common = Math.max(0, amount - used);
  return { common, uncommon, rare, epic, legendary };
}

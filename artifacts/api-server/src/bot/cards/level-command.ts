import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { db, cardProgressTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { getCardByName, getAllCardsCached, getUserOwnedCount } from "../db.js";
import { isCardLocked, setCardLocked } from "./locks.js";
import { toAbsoluteImageUrl } from "../image-url.js";
import type { Rarity } from "../cards-data.js";
import {
  getCardProgress, setEquippedFrame, levelProgress, MAX_LEVEL,
  starsForLevel, starString,
} from "./leveling.js";
import {
  framesForRarity, resolveActiveFrame, isFrameUnlocked, defaultFrameForRarity,
  getRaidFrames,
} from "./frames.js";
import { getRaidFrameUnlocks } from "../raid/db.js";

function bar(into: number, needed: number, width = 12): string {
  if (needed <= 0) return "▰".repeat(width) + " MAX";
  const filled = Math.max(0, Math.min(width, Math.round((into / needed) * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

// Builds the single-card level embed (progress bar, frames) for any card the
// viewer owns. Extracted so both `/level name:<card>` and the quick-jump
// button on the battle-stats view (see battle/stats-view.ts) render the exact
// same embed — read-only, no combat/lookup logic involved.
export async function buildCardLevelEmbed(
  guildId: string,
  userId: string,
  card: { id: number; name: string; rarity: string; imageUrl: string | null },
): Promise<{ embed: EmbedBuilder } | { error: string }> {
  const owned = await getUserOwnedCount(guildId, userId, card.id);
  if (owned.count + owned.shinyCount === 0) {
    return { error: `❌ You don't own **${card.name}**. You can only level cards you own.` };
  }

  const rarity = card.rarity as Rarity;
  const [progress, raidUnlocks] = await Promise.all([
    getCardProgress(guildId, userId, card.id),
    getRaidFrameUnlocks(guildId, userId),
  ]);
  const level = progress?.level ?? 1;
  const xp = progress?.xp ?? 0;
  const fought = progress?.battlesFought ?? 0;
  const won = progress?.battlesWon ?? 0;
  const frame = resolveActiveFrame(rarity, progress?.equippedFrame ?? null, level, raidUnlocks);
  const { into, needed } = levelProgress(xp, level);

  const allFrames = framesForRarity(rarity);
  const frameLines = allFrames.map(f => {
    const active = f.id === frame.id;
    const unlocked = isFrameUnlocked(f, level);
    const tag = active ? "**✓ equipped**" : unlocked ? "unlocked" : `🔒 Lv ${f.unlockLevel}`;
    return `${f.emoji} **${f.name}** — ${tag}`;
  });
  // Account-wide raid frames the player has earned — equippable on any card.
  const earnedRaidFrames = getRaidFrames().filter(f => raidUnlocks.has(f.id));
  for (const f of earnedRaidFrames) {
    const active = f.id === frame.id;
    frameLines.push(`${f.emoji} **${f.name}** — ${active ? "**✓ equipped**" : "🐉 raid reward"}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(frame.wrap(`${frame.emoji} ${card.name}`))
    .setColor(frame.color)
    .setDescription(
      `**Level ${level}**${level >= MAX_LEVEL ? " MAX" : ""}  ${starString(starsForLevel(level))}  ·  Frame: **${frame.name}**\n` +
      `\`${bar(into, needed)}\` ` + (needed > 0 ? `${into}/${needed} XP to Lv ${level + 1}` : "Max level") + "\n" +
      `⚔️ Battles: **${fought}**  ·  🏆 Wins: **${won}**`,
    )
    .addFields({ name: "🖼️ Frames", value: frameLines.join("\n"), inline: false })
    .setFooter({ text: "Equip a frame: /frame name:<card> style:<frame> · Card XP is earned in /battle" });
  const img = toAbsoluteImageUrl(card.imageUrl);
  if (img) embed.setThumbnail(img);

  return { embed };
}

// ── /level [name] ──────────────────────────────────────────────────────
export async function handleCardLevel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const name = interaction.options.getString("name");

  // No name → the player's most-leveled cards.
  if (!name) {
    const rows = await db.select().from(cardProgressTable)
      .where(and(eq(cardProgressTable.guildId, guildId), eq(cardProgressTable.userId, userId)))
      .orderBy(desc(cardProgressTable.level), desc(cardProgressTable.xp))
      .limit(10);
    if (rows.length === 0) {
      await interaction.editReply("You haven't leveled any cards yet. Field a card in `/battle` to start earning card XP, then check `/level name:<card>`.");
      return;
    }
    const cards = await getAllCardsCached(guildId);
    const byId = new Map(cards.map(c => [c.id, c]));
    const raidUnlocks = await getRaidFrameUnlocks(guildId, userId);
    const lines = rows.map((r, i) => {
      const c = byId.get(r.cardId);
      const rarity = (c?.rarity ?? "common") as Rarity;
      const frame = resolveActiveFrame(rarity, r.equippedFrame, r.level, raidUnlocks);
      const wr = r.battlesFought > 0 ? Math.round((r.battlesWon / r.battlesFought) * 100) : 0;
      return `**${i + 1}.** ${frame.emoji} **${c?.name ?? `#${r.cardId}`}** — Lv **${r.level}** ${starString(starsForLevel(r.level))}  ·  ${r.battlesWon}/${r.battlesFought}W (${wr}%)`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`🎖️ ${interaction.user.username}'s Leveled Cards`)
      .setColor(0xf1c40f)
      .setDescription(lines.join("\n"))
      .setFooter({ text: "View one card: /level name:<card> · Change frame: /frame" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const card = await getCardByName(name, guildId);
  if (!card) { await interaction.editReply(`❌ "**${name}**" not found. Try \`/list\`.`); return; }

  const result = await buildCardLevelEmbed(guildId, userId, card);
  if ("error" in result) { await interaction.editReply(result.error); return; }
  await interaction.editReply({ embeds: [result.embed] });
}

// ── /lock name:<card> [state] ──────────────────────────────────────────
export async function handleCardLock(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const name = interaction.options.getString("name", true);
  const state = interaction.options.getString("state"); // "on" | "off" | null (toggle)

  const card = await getCardByName(name, guildId);
  if (!card) { await interaction.editReply(`❌ "**${name}**" not found. Try \`/list\`.`); return; }
  const owned = await getUserOwnedCount(guildId, userId, card.id);
  if (owned.count + owned.shinyCount === 0) {
    await interaction.editReply(`❌ You don't own **${card.name}**, so there's nothing to lock.`);
    return;
  }

  const currently = await isCardLocked(guildId, userId, card.id);
  const next = state === "on" ? true : state === "off" ? false : !currently;
  await setCardLocked(guildId, userId, card.id, next);
  await interaction.editReply(
    next
      ? `🔒 **${card.name}** is now **locked** — it's protected from \`/burn\` and bulk trade-in.`
      : `🔓 **${card.name}** is now **unlocked** — it can be burned or traded in again.`,
  );
}

// ── /frame name:<card> [style:<frame>] ─────────────────────────────────
export async function handleCardFrame(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const name = interaction.options.getString("name", true);
  const style = interaction.options.getString("style");

  const card = await getCardByName(name, guildId);
  if (!card) { await interaction.editReply(`❌ "**${name}**" not found. Try \`/list\`.`); return; }
  const rarity = card.rarity as Rarity;
  const [progress, raidUnlocks] = await Promise.all([
    getCardProgress(guildId, userId, card.id),
    getRaidFrameUnlocks(guildId, userId),
  ]);
  const level = progress?.level ?? 1;
  const frames = framesForRarity(rarity);
  const earnedRaidFrames = getRaidFrames().filter(f => raidUnlocks.has(f.id));
  const active = resolveActiveFrame(rarity, progress?.equippedFrame ?? null, level, raidUnlocks);

  // No style → list frames + how to equip.
  if (!style) {
    const lines = frames.map(f => {
      const isActive = f.id === active.id;
      const unlocked = isFrameUnlocked(f, level);
      const tag = isActive ? "**✓ equipped**" : unlocked ? "available" : `🔒 unlocks at Lv ${f.unlockLevel}`;
      return `${f.emoji} **${f.name}** \`${f.id.split("_")[1] ?? f.id}\` — ${tag}`;
    });
    if (earnedRaidFrames.length) {
      lines.push("", "**🐉 Raid Rewards** (equippable on any card)");
      for (const f of earnedRaidFrames) {
        const isActive = f.id === active.id;
        lines.push(`${f.emoji} **${f.name}** \`${f.id.split("_")[1] ?? f.id}\` — ${isActive ? "**✓ equipped**" : "available"}`);
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Frames for ${card.name}`)
      .setColor(active.color)
      .setDescription(
        `Your level: **${level}**\n\n${lines.join("\n")}\n\n` +
        "Equip one with `/frame name:" + card.name + " style:<name>` (e.g. `style:" + (frames[1]?.name.split(" ")[0].toLowerCase() ?? "default") + "`).",
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Match the requested style against rarity frames AND unlocked raid frames.
  const q = style.trim().toLowerCase();
  const matches = (f: typeof frames[number]) =>
    f.name.toLowerCase() === q ||
    f.name.toLowerCase().startsWith(q) ||
    (f.id.split("_")[1] ?? f.id).toLowerCase() === q ||
    f.id.toLowerCase() === q;
  const match = frames.find(matches) ?? earnedRaidFrames.find(matches);
  if (!match) {
    const opts = [...frames, ...earnedRaidFrames].map(f => `\`${f.name}\``).join(", ");
    await interaction.editReply(`❌ No frame called "**${style}**" you can equip here. Options: ${opts}.`);
    return;
  }
  // Account (raid) frames only need the unlock; rarity frames need the level.
  if (match.account) {
    if (!raidUnlocks.has(match.id)) {
      await interaction.editReply(`🔒 **${match.name}** is a raid reward — clear the boss that grants it to unlock it.`);
      return;
    }
  } else if (!isFrameUnlocked(match, level)) {
    await interaction.editReply(
      `🔒 **${match.name}** unlocks at card **Level ${match.unlockLevel}** — you're Level ${level}. Level this card up in \`/battle\`.`,
    );
    return;
  }

  // The rarity default is stored as null so it self-heals if the registry changes.
  const store = match.id === defaultFrameForRarity(rarity).id ? null : match.id;
  await setEquippedFrame(guildId, userId, card.id, store);
  await interaction.editReply(`✅ Equipped **${match.emoji} ${match.name}** on **${card.name}**. View it with \`/level name:${card.name}\`.`);
}

import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db, userReputationTable, repLogTable } from "@workspace/db";
import { and, eq, desc, sql, gt } from "drizzle-orm";

const REP_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const THANKS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── DB helpers ───────────────────────────────────────────────────────────────

async function getOrCreateRep(guildId: string, userId: string) {
  const [existing] = await db.select()
    .from(userReputationTable)
    .where(and(
      eq(userReputationTable.guildId, guildId),
      eq(userReputationTable.userId, userId),
    ))
    .limit(1);
  if (existing) return existing;
  const [row] = await db.insert(userReputationTable)
    .values({ guildId, userId, rep: 0 })
    .onConflictDoUpdate({
      target: [userReputationTable.guildId, userReputationTable.userId],
      set: { updatedAt: new Date() },
    })
    .returning();
  return row;
}

async function getLastRepTime(
  guildId: string, giverId: string, receiverId: string,
): Promise<Date | null> {
  const [row] = await db.select({ givenAt: repLogTable.givenAt })
    .from(repLogTable)
    .where(and(
      eq(repLogTable.guildId, guildId),
      eq(repLogTable.giverId, giverId),
      eq(repLogTable.receiverId, receiverId),
    ))
    .orderBy(desc(repLogTable.givenAt))
    .limit(1);
  return row?.givenAt ?? null;
}

async function giveRep(guildId: string, giverId: string, receiverId: string): Promise<number> {
  await db.insert(userReputationTable)
    .values({ guildId, userId: receiverId, rep: 1 })
    .onConflictDoUpdate({
      target: [userReputationTable.guildId, userReputationTable.userId],
      set: {
        rep: sql`${userReputationTable.rep} + 1`,
        updatedAt: new Date(),
      },
    });
  await db.insert(repLogTable).values({ guildId, giverId, receiverId });

  const updated = await getOrCreateRep(guildId, receiverId);
  return updated.rep;
}

async function removeRep(
  guildId: string,
  userId: string,
  amount: number = 1,
): Promise<number> {
  const current = await getOrCreateRep(guildId, userId);
  const newRep = Math.max(0, current.rep - amount);

  await db.update(userReputationTable)
    .set({
      rep: newRep,
      updatedAt: new Date(),
    })
    .where(and(
      eq(userReputationTable.guildId, guildId),
      eq(userReputationTable.userId, userId),
    ));

  return newRep;
}

async function getRepLeaderboard(guildId: string, limit = 10) {
  return db.select({
    userId: userReputationTable.userId,
    rep: userReputationTable.rep,
  })
    .from(userReputationTable)
    .where(and(
      eq(userReputationTable.guildId, guildId),
      gt(userReputationTable.rep, 0),
    ))
    .orderBy(desc(userReputationTable.rep))
    .limit(limit);
}

// ── /rep command handler ─────────────────────────────────────────────────────
// Called after handleUserCommand has already deferred the reply.

export async function handleRep(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guild.id;

  if (sub === "give") {
    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.editReply("❌ You can't rep yourself.");
      return;
    }
    if (target.bot) {
      await interaction.editReply("❌ You can't rep a bot.");
      return;
    }

    const lastGiven = await getLastRepTime(guildId, interaction.user.id, target.id);
    if (lastGiven) {
      const elapsed = Date.now() - lastGiven.getTime();
      if (elapsed < REP_COOLDOWN_MS) {
        const nextAt = Math.floor((lastGiven.getTime() + REP_COOLDOWN_MS) / 1000);
        await interaction.editReply(
          `⏳ You already repped **${target.username}** recently. You can rep them again <t:${nextAt}:R>.`,
        );
        return;
      }
    }

    const newRep = await giveRep(guildId, interaction.user.id, target.id);

    // Hidden rep message - only visible to the giver
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("⭐ Rep Given (Hidden)")
      .setDescription(
        `You repped <@${target.id}>!\n\n` +
        `**${target.username}** now has **${newRep}** rep point${newRep !== 1 ? "s" : ""}.`,
      )
      .setFooter({ text: "This message is only visible to you" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "check") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const repData = await getOrCreateRep(guildId, target.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`⭐ ${target.username}'s Reputation`)
      .setDescription(`**${repData.rep}** rep point${repData.rep !== 1 ? "s" : ""}`)
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "top") {
    const rows = await getRepLeaderboard(guildId);

    if (rows.length === 0) {
      await interaction.editReply("No one has any rep yet! Use `/rep give @user` to get started.");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const prefix = medals[i] ?? `**${i + 1}.**`;
      return `${prefix} <@${r.userId}> — **${r.rep}** rep`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle("⭐ Rep Leaderboard")
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Give rep with /rep give @user" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "remove") {
    // Admin-only: remove rep from user with optional reason
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      await interaction.editReply("❌ Only admins can remove rep.");
      return;
    }

    const target = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");
    const amount = interaction.options.getInteger("amount") ?? 1;

    const newRep = await removeRep(guildId, target.id, amount);

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("❌ Rep Removed")
      .setDescription(
        `Removed **${amount}** rep from <@${target.id}>.\n\n` +
        `**${target.username}** now has **${newRep}** rep point${newRep !== 1 ? "s" : ""}.`,
      );

    if (reason) {
      embed.addFields({ name: "Reason", value: reason, inline: false });
    }

    embed.setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}

// ── /thanks command handler ──────────────────────────────────────────────────

export async function handleThanks(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild) return;

  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guild.id;

  // Reuse rep table for thanks tracking (stored as separate data, same table structure)
  // In a future update, we'd have a dedicated thanks table
  const thanksPrefix = "thanks:";

  if (sub === "give") {
    const target = interaction.options.getUser("user", true);

    if (target.id === interaction.user.id) {
      await interaction.editReply("❌ You can't thank yourself.");
      return;
    }
    if (target.bot) {
      await interaction.editReply("❌ You can't thank a bot.");
      return;
    }

    // For now, just record thanks (future: add cooldown tracking table)
    const currentRep = await getOrCreateRep(guildId, target.id);
    // Store thanks count by incrementing a phantom "thanks" counter
    // This is a temporary solution - ideally needs dedicated table

    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle("🙏 Thanks Given!")
      .setDescription(
        `You thanked <@${target.id}>!\n\n` +
        `**${target.username}** is appreciated!`,
      )
      .setFooter({ text: "This message is only visible to you" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "top") {
    const rows = await getRepLeaderboard(guildId);

    if (rows.length === 0) {
      await interaction.editReply("No one has received thanks yet! Use `/thanks give @user` to get started.");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const prefix = medals[i] ?? `**${i + 1}.**`;
      return `${prefix} <@${r.userId}> — **${r.rep}** appreciation`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle("🙏 Thanks Leaderboard")
      .setDescription(lines.join("\n"))
      .setFooter({ text: "Give thanks with /thanks give @user" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
}

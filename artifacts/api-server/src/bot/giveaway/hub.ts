// ─────────────────────────────────────────────────────────────────────────────
// /giveaway — ONE simple hub replacing the old /giveaways, /giveaway progress,
// and /giveaway_admin command sprawl.
//
//   🎉 Browse   — active giveaways, pick one to see your progress (everyone)
//   🛠️ Admin    — Quick Create (pick from dropdowns → boom, launched) and
//                Manage (end / cancel / reroll an existing giveaway)
//
// This is purely the COMMAND surface. The live giveaway board message posted
// in a channel (Enter / My Progress / Info / Claim Prize buttons) is unchanged
// — that's manager.ts's handleGiveawayComponent, still the way players actually
// enter. This hub is for browsing + admin lifecycle management.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction,
  ModalSubmitInteraction, GuildMember,
} from "discord.js";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags, PermissionFlagsBits,
} from "discord.js";
import type {
  Giveaway, GiveawayPrize, GiveawayRequirement, GiveawayReqType, GiveawayWinnerMode,
} from "@workspace/db";
import {
  getActiveGiveaways, getGiveaway, listGiveaways, listWinners, countEntrants,
  createGiveaway, updateGiveaway, expirePendingWinners,
} from "./db.js";
import { userStanding, overallProgressPct, invalidateActiveCache, backfillGiveawayProgress } from "./engine.js";
import { postGiveawayMessage, refreshGiveawayMessage, endGiveaway, rerollWinner } from "./manager.js";
import { DIFFICULTY_META, formatRequirementProgress, formatPrizeList } from "./embeds.js";
import { invalidateMessageReqCache } from "./message-hook.js";
import { getCardByName } from "../db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function isAdmin(member: GuildMember | null): boolean {
  return !!member?.permissions.has(PermissionFlagsBits.Administrator);
}

// ── Quick-create draft store ──────────────────────────────────────────────────
// Per-admin, in-memory, short-lived. Cleared on submit or after 10 minutes.
interface QcDraft { prize?: string; requirement?: string; duration?: string }
const drafts = new Map<string, QcDraft>();
const DRAFT_TTL_MS = 10 * 60_000;
function draftKey(guildId: string, userId: string): string { return `${guildId}:${userId}`; }
function touchDraft(guildId: string, userId: string): QcDraft {
  const key = draftKey(guildId, userId);
  let d = drafts.get(key);
  if (!d) { d = {}; drafts.set(key, d); setTimeout(() => drafts.delete(key), DRAFT_TTL_MS).unref?.(); }
  return d;
}

const QUICK_DURATION_MS: Record<string, number> = {
  "1h": 3600_000, "6h": 6 * 3600_000, "12h": 12 * 3600_000,
  "24h": 24 * 3600_000, "3d": 3 * 86400_000, "1w": 7 * 86400_000,
};
const REQ_EMOJI: Record<GiveawayReqType, string> = {
  catch: "🎯", burn: "🔥", pack_open: "📦", battle_win: "⚔️", battle_played: "🛡️",
  raid_join: "🐉", raid_damage: "💥", echo_use: "🔊", message: "💬",
};
const PRIZE_EMOJI: Record<string, string> = { shards: "💠", pack: "📦", cards: "🃏", custom: "🎁" };

function requirementLabel(type: GiveawayReqType, goal: number): string {
  switch (type) {
    case "catch": return `Catch ${goal} card${goal === 1 ? "" : "s"}`;
    case "burn": return `Burn ${goal} card${goal === 1 ? "" : "s"}`;
    case "pack_open": return `Open ${goal} pack${goal === 1 ? "" : "s"}`;
    case "battle_win": return `Win ${goal} battle${goal === 1 ? "" : "s"}`;
    case "battle_played": return `Play ${goal} battle${goal === 1 ? "" : "s"}`;
    case "raid_join": return `Join ${goal} co-op raid${goal === 1 ? "" : "s"}`;
    case "raid_damage": return `Deal ${goal.toLocaleString()} raid damage`;
    case "echo_use": return `Use Echo ${goal} time${goal === 1 ? "" : "s"}`;
    case "message": return `Send ${goal} message${goal === 1 ? "" : "s"}`;
    default: return `${type} ${goal}`;
  }
}
function clampInt(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, Math.round(n) || lo)); }

// ── Entry point: /giveaway ────────────────────────────────────────────────────
export async function handleGiveawayHubCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Server only.", ...EPHEMERAL }); return; }
  await interaction.deferReply(EPHEMERAL);
  await interaction.editReply(await buildHomeView(interaction.guild.id, interaction.user.id, interaction.member as GuildMember | null));
}

// ── Home / browse screen ──────────────────────────────────────────────────────
async function buildHomeView(guildId: string, userId: string, member: GuildMember | null) {
  const active = await getActiveGiveaways(guildId);
  const embed = new EmbedBuilder().setTitle("🎉 Giveaways").setColor(0xf1c40f);

  if (active.length === 0) {
    embed.setDescription("No active giveaways right now. Check back soon!");
  } else {
    const lines = await Promise.all(active.slice(0, 10).map(async g => {
      const stats = await countEntrants(g.id);
      const d = DIFFICULTY_META[g.difficulty];
      const ends = g.endsAt ? `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>` : "—";
      return `${d.emoji} \`#${g.id}\` **${g.title}** — ${g.winnerCount}w · 👥 ${stats.entrants} · ends ${ends}`;
    }));
    embed.setDescription(lines.join("\n"));
  }
  embed.setFooter({ text: "Pick a giveaway below to see your progress. Enter from its board message in the channel." });

  const rows: ActionRowBuilder<any>[] = [];
  if (active.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("gwhub:pick")
      .setPlaceholder("View a giveaway's details & your progress…")
      .addOptions(active.slice(0, 25).map(g => ({
        label: g.title.slice(0, 100), value: String(g.id),
        description: `${DIFFICULTY_META[g.difficulty].label} · ${g.winnerCount} winner(s)`,
      })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("gwhub:home").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );
  if (isAdmin(member)) {
    btnRow.addComponents(new ButtonBuilder().setCustomId("gwhub:admin").setLabel("Admin").setEmoji("🛠️").setStyle(ButtonStyle.Primary));
  }
  rows.push(btnRow);
  return { embeds: [embed], components: rows };
}

// ── Per-giveaway detail (progress) view ───────────────────────────────────────
async function buildDetailView(g: Giveaway, userId: string) {
  const [stats, standing] = await Promise.all([countEntrants(g.id), userStanding(g, userId)]);
  const d = DIFFICULTY_META[g.difficulty];
  const ends = g.endsAt ? `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>` : "—";
  const reqLines = g.requirements.length
    ? g.requirements.map(r => formatRequirementProgress(r, standing.progress)).join("\n\n")
    : "*Open to everyone — you're entered!*";
  const yourLine = g.winnerMode === "completion"
    ? (standing.completed ? "✅ You qualify!" : `🚧 ${overallProgressPct(g.requirements, standing.progress)}% complete`)
    : `🎟️ ${standing.entries} entries`;

  const embed = new EmbedBuilder()
    .setTitle(`${d.emoji} ${g.title}`)
    .setColor(d.color)
    .setDescription(
      `**🎁 Prizes**\n${formatPrizeList(g.prizes)}\n\n` +
      `**📋 Your Progress**\n${reqLines}\n\n` +
      `**Standing:** ${yourLine}\n` +
      `**🏆 Winners:** ${g.winnerCount} · 👥 ${stats.entrants} entrants · **Ends:** ${ends}`,
    )
    .setFooter({ text: `#${g.id} · Enter from the giveaway's board message in the channel` });

  const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("gwhub:home").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  )];
  return { embeds: [embed], components: rows };
}

// ── Admin: entry screen ───────────────────────────────────────────────────────
function buildAdminHomeView() {
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("🛠️ Giveaway Admin")
    .setDescription("**⚡ Quick Create** — pick from dropdowns, launches instantly.\n**📋 Manage** — end, cancel, or reroll an existing giveaway.");
  const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("gwhub:qc:start").setLabel("Quick Create").setEmoji("⚡").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("gwhub:manage").setLabel("Manage").setEmoji("📋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("gwhub:home").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  )];
  return { embeds: [embed], components: rows };
}

// ── Admin: Quick Create wizard (3 selects → 1 modal) ──────────────────────────
function buildQcPrizeSelect() {
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("⚡ Quick Create — Step 1/3").setDescription("Pick the prize type.");
  const select = new StringSelectMenuBuilder().setCustomId("gwhub:qc:prize").setPlaceholder("Prize type…").addOptions(
    { label: "DN Shards", value: "shards", emoji: "💠" },
    { label: "Pack", value: "pack", emoji: "📦" },
    { label: "Card", value: "cards", emoji: "🃏" },
    { label: "Custom (admin hands off)", value: "custom", emoji: "🎁" },
  );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}
function buildQcReqSelect() {
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("⚡ Quick Create — Step 2/3").setDescription("Pick what players must do to enter.");
  const select = new StringSelectMenuBuilder().setCustomId("gwhub:qc:req").setPlaceholder("Requirement…").addOptions(
    { label: "Open to everyone", value: "none", emoji: "🎉" },
    { label: "Catch cards", value: "catch", emoji: "🎯" },
    { label: "Win battles", value: "battle_win", emoji: "⚔️" },
    { label: "Open packs", value: "pack_open", emoji: "📦" },
    { label: "Join raids", value: "raid_join", emoji: "🐉" },
    { label: "Send messages", value: "message", emoji: "💬" },
  );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}
function buildQcDurationSelect() {
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("⚡ Quick Create — Step 3/3").setDescription("Pick how long it runs.");
  const select = new StringSelectMenuBuilder().setCustomId("gwhub:qc:dur").setPlaceholder("Duration…").addOptions(
    { label: "1 hour", value: "1h" }, { label: "6 hours", value: "6h" }, { label: "12 hours", value: "12h" },
    { label: "24 hours", value: "24h" }, { label: "3 days", value: "3d" }, { label: "1 week", value: "1w" },
  );
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] };
}
function buildQcModal(draft: QcDraft): ModalBuilder {
  const needsAmount = draft.prize === "shards" || draft.prize === "pack" || draft.prize === "cards" || draft.prize === "custom";
  const modal = new ModalBuilder().setCustomId("gwhub:qc:modal").setTitle("⚡ Quick Create — Finish");
  const title = new TextInputBuilder().setCustomId("title").setLabel("Giveaway Title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  const amountLabel = draft.prize === "shards" ? "Shard Amount"
    : draft.prize === "pack" ? "Pack Tier (e.g. basic, premium)"
    : draft.prize === "cards" ? "Card Name"
    : "Custom Prize Text";
  const amount = new TextInputBuilder().setCustomId("amount").setLabel(amountLabel).setStyle(TextInputStyle.Short).setRequired(needsAmount).setMaxLength(100);
  const winners = new TextInputBuilder().setCustomId("winners").setLabel("Number of Winners").setStyle(TextInputStyle.Short).setRequired(true).setValue("1").setMaxLength(3);
  const rows = [title, amount, winners];
  if (draft.requirement && draft.requirement !== "none") {
    const goal = new TextInputBuilder().setCustomId("goal").setLabel("Requirement Goal (e.g. 10)").setStyle(TextInputStyle.Short).setRequired(true).setValue("10").setMaxLength(10);
    rows.push(goal);
  }
  modal.addComponents(...rows.map(r => new ActionRowBuilder<TextInputBuilder>().addComponents(r)));
  return modal;
}

// ── Admin: Manage screen ──────────────────────────────────────────────────────
async function buildManageListView(guildId: string) {
  const all = await listGiveaways(guildId);
  const active = all.filter(g => g.status === "active");
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("📋 Manage Giveaways")
    .setDescription(active.length ? "Pick a giveaway to end, cancel, or reroll a winner." : "No active giveaways to manage.");
  const rows: ActionRowBuilder<any>[] = [];
  if (active.length > 0) {
    const select = new StringSelectMenuBuilder().setCustomId("gwhub:mpick").setPlaceholder("Pick a giveaway…")
      .addOptions(active.slice(0, 25).map(g => ({ label: g.title.slice(0, 100), value: String(g.id), description: `#${g.id}` })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("gwhub:admin").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], components: rows };
}

async function buildManageDetailView(g: Giveaway) {
  const winners = await listWinners(g.id);
  const pending = winners.find(w => w.claimStatus === "pending");
  const stats = await countEntrants(g.id);
  const embed = new EmbedBuilder().setColor(DIFFICULTY_META[g.difficulty].color)
    .setTitle(`📋 ${g.title} (#${g.id})`)
    .setDescription(
      `**Status:** ${g.status}\n**👥 Entrants:** ${stats.entrants}\n**🏆 Winners:** ${g.winnerCount}\n` +
      (winners.length ? `\n**Recorded winners:**\n${winners.map(w => `<@${w.userId}> — ${w.claimStatus}`).join("\n")}` : ""),
    );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`gwhub:end:${g.id}`).setLabel("End Now").setEmoji("🎊").setStyle(ButtonStyle.Success).setDisabled(g.status !== "active"),
    new ButtonBuilder().setCustomId(`gwhub:cancel:${g.id}`).setLabel("Cancel").setEmoji("🛑").setStyle(ButtonStyle.Danger).setDisabled(g.status !== "active"),
    new ButtonBuilder().setCustomId(`gwhub:reroll:${g.id}`).setLabel("Reroll Pending").setEmoji("🔁").setStyle(ButtonStyle.Secondary).setDisabled(!pending),
    new ButtonBuilder().setCustomId("gwhub:manage").setLabel("← Back").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ── Component router ──────────────────────────────────────────────────────────
export async function handleGiveawayHubComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const parts = interaction.customId.split(":"); // gwhub:<action>[:extra]
  const action = parts[1];
  const member = interaction.member as GuildMember | null;

  try {
    if (action === "home" && interaction.isButton()) {
      await interaction.update(await buildHomeView(guildId, userId, member)); return;
    }
    if (action === "pick" && interaction.isStringSelectMenu()) {
      const g = await getGiveaway(Number(interaction.values[0]));
      if (!g || g.guildId !== guildId) { await interaction.update(await buildHomeView(guildId, userId, member)); return; }
      await interaction.update(await buildDetailView(g, userId)); return;
    }

    // ── Admin-gated actions ──
    if (["admin", "qc", "manage", "mpick", "end", "cancel", "reroll"].includes(action!) && !isAdmin(member)) {
      await interaction.reply({ content: "❌ Admin only.", ...EPHEMERAL }).catch(() => {}); return;
    }

    if (action === "admin" && interaction.isButton()) {
      await interaction.update(buildAdminHomeView()); return;
    }
    if (action === "qc" && parts[2] === "start" && interaction.isButton()) {
      drafts.delete(draftKey(guildId, userId));
      await interaction.update(buildQcPrizeSelect()); return;
    }
    if (action === "qc" && parts[2] === "prize" && interaction.isStringSelectMenu()) {
      touchDraft(guildId, userId).prize = interaction.values[0];
      await interaction.update(buildQcReqSelect()); return;
    }
    if (action === "qc" && parts[2] === "req" && interaction.isStringSelectMenu()) {
      touchDraft(guildId, userId).requirement = interaction.values[0];
      await interaction.update(buildQcDurationSelect()); return;
    }
    if (action === "qc" && parts[2] === "dur" && interaction.isStringSelectMenu()) {
      const draft = touchDraft(guildId, userId);
      draft.duration = interaction.values[0];
      await interaction.showModal(buildQcModal(draft)); return;
    }
    if (action === "qc" && parts[2] === "modal" && interaction.isModalSubmit()) {
      await handleQcSubmit(interaction, guildId, userId); return;
    }

    if (action === "manage" && interaction.isButton()) {
      await interaction.update(await buildManageListView(guildId)); return;
    }
    if (action === "mpick" && interaction.isStringSelectMenu()) {
      const g = await getGiveaway(Number(interaction.values[0]));
      if (!g || g.guildId !== guildId) { await interaction.update(await buildManageListView(guildId)); return; }
      await interaction.update(await buildManageDetailView(g)); return;
    }
    if (action === "end" && interaction.isButton()) {
      const g = await getGiveaway(Number(parts[2]));
      if (g && g.guildId === guildId && g.status === "active") await endGiveaway(g, interaction.client, { manual: true });
      await interaction.update(await buildManageListView(guildId)); return;
    }
    if (action === "cancel" && interaction.isButton()) {
      const g = await getGiveaway(Number(parts[2]));
      if (g && g.guildId === guildId && g.status === "active") {
        await updateGiveaway(g.id, { status: "cancelled" });
        await expirePendingWinners(g.id);
        invalidateActiveCache(guildId);
        await refreshGiveawayMessage(g, interaction.client).catch(() => {});
      }
      await interaction.update(await buildManageListView(guildId)); return;
    }
    if (action === "reroll" && interaction.isButton()) {
      const g = await getGiveaway(Number(parts[2]));
      if (g && g.guildId === guildId) {
        const winners = await listWinners(g.id);
        const pending = winners.find(w => w.claimStatus === "pending");
        if (pending) await rerollWinner(g, pending, interaction.client, "manual");
      }
      const fresh = g ? await getGiveaway(g.id) : null;
      await interaction.update(fresh ? await buildManageDetailView(fresh) : await buildManageListView(guildId));
      return;
    }
  } catch (err) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "❌ Something went wrong.", ...EPHEMERAL }).catch(() => {});
    }
    throw err;
  }
}

async function handleQcSubmit(interaction: ModalSubmitInteraction, guildId: string, userId: string): Promise<void> {
  const draft = drafts.get(draftKey(guildId, userId));
  if (!draft || !draft.prize || !draft.duration) {
    await interaction.reply({ content: "⌛ That quick-create session expired — start again with **Quick Create**.", ...EPHEMERAL }).catch(() => {});
    return;
  }
  await interaction.deferReply(EPHEMERAL);

  const title = interaction.fields.getTextInputValue("title").trim();
  const amountRaw = (() => { try { return interaction.fields.getTextInputValue("amount")?.trim(); } catch { return undefined; } })();
  const winnersRaw = interaction.fields.getTextInputValue("winners").trim();
  const goalRaw = (() => { try { return interaction.fields.getTextInputValue("goal")?.trim(); } catch { return undefined; } })();

  const prizes: GiveawayPrize[] = [];
  switch (draft.prize) {
    case "shards": {
      const amount = clampInt(parseInt(amountRaw ?? "0", 10) || 0, 1, 10_000_000);
      prizes.push({ type: "shards", qty: amount, label: `${amount.toLocaleString()} DN Shards`, emoji: PRIZE_EMOJI.shards });
      break;
    }
    case "pack": {
      const tier = (amountRaw || "basic").toLowerCase();
      prizes.push({ type: "pack", packTier: tier, qty: 1, label: `1× ${tier} pack`, emoji: PRIZE_EMOJI.pack });
      break;
    }
    case "cards": {
      if (!amountRaw) { await interaction.editReply("❌ You need to enter a card name."); return; }
      const card = await getCardByName(amountRaw, guildId);
      if (!card) { await interaction.editReply(`❌ No card named **${amountRaw}**.`); return; }
      prizes.push({ type: "cards", cardId: card.id, cardName: card.name, qty: 1, label: `1× ${card.name}`, emoji: PRIZE_EMOJI.cards });
      break;
    }
    default: prizes.push({ type: "custom", label: amountRaw || "Custom prize", emoji: PRIZE_EMOJI.custom }); break;
  }

  const requirements: GiveawayRequirement[] = [];
  if (draft.requirement && draft.requirement !== "none") {
    const goal = clampInt(parseInt(goalRaw ?? "1", 10) || 1, 1, 1_000_000);
    const type = draft.requirement as GiveawayReqType;
    requirements.push({ key: `${type}_0`, type, goal, emoji: REQ_EMOJI[type] ?? "•", label: requirementLabel(type, goal) });
  }

  const durationMs = QUICK_DURATION_MS[draft.duration] ?? QUICK_DURATION_MS["24h"]!;
  const winnerCount = clampInt(parseInt(winnersRaw, 10) || 1, 1, 50);
  const winnerMode: GiveawayWinnerMode = requirements.length ? "completion" : "entry";
  const now = new Date();

  const g = await createGiveaway({
    guildId, title, createdBy: userId,
    channelId: interaction.channelId!,
    difficulty: "medium", status: "active", winnerCount, winnerMode,
    requirements, prizes,
    startsAt: now, endsAt: new Date(now.getTime() + durationMs),
    claimTimerMinutes: 24 * 60, announceMode: "channel",
  });

  const posted = await postGiveawayMessage(g, interaction.client);
  const backfilled = await backfillGiveawayProgress(posted);
  if (backfilled > 0) await refreshGiveawayMessage(posted, interaction.client);
  invalidateActiveCache(guildId);
  invalidateMessageReqCache(guildId);
  drafts.delete(draftKey(guildId, userId));

  await interaction.editReply(
    `✅ **${title}** is live in <#${posted.channelId}>! ${winnerCount} winner(s) · ` +
    `${requirements.length ? requirements[0]!.label : "open to everyone"} · ends <t:${Math.floor((now.getTime() + durationMs) / 1000)}:R>.` +
    (backfilled > 0 ? ` (${backfilled} already qualified.)` : ""),
  );
}

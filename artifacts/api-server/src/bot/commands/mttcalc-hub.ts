import {
  ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction,
  EmbedBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
  GuildMember,
  type GuildTextBasedChannel, type TextBasedChannel,
} from "discord.js";
import {
  fetchMTTVItems, formatMTTVValue, getMTTVAverageValue, matchScore,
  calcItemValue, calcWeightedDemand, calcSideValue, shortValue,
  type MTTVItem, type CalcItem, type CalcTier,
} from "./mttvalues.js";
import { createCalculatorMessage, getCalculatorMessage, isAdmin } from "../db.js";
import type { CalculatorMessage } from "@workspace/db";
import { logger } from "../../lib/logger.js";

// ── Persistent MTTV Trade Calculator Hub ─────────────────────────────────────
// Admins post a hub message with /postcalculator. The hub has four buttons:
// Your Items, Their Items, Calculate, Clear. Every user gets their own ephemeral
// session keyed by (messageId, userId), so unlimited users can use the same hub
// simultaneously without interfering. Item lookup uses the same MTTV fuzzy
// search as /info_mttv and /calc.

const MAX_ITEMS = 3;
const PREFIX = "mttcalc_hub";

const TIER_CHOICES: CalcTier[] = ["low", "mid", "high"];

const STAR_LABELS = ["", "⭐", "⭐⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"];

const EMPTY_SIDE = "*No items yet — press Add Item*";

// Ephemeral per-user sessions. Lost on restart, which is fine: a user simply
// starts a new session the next time they press a hub button.
type UserSession = {
  yourItems: CalcItem[];
  theirItems: CalcItem[];
  lastSearch: { your: MTTVItem[] | null; their: MTTVItem[] | null };
  touchedAt: number;
};
const sessions = new Map<string, UserSession>();

function sessionKey(messageId: string, userId: string) {
  return `${messageId}:${userId}`;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour of inactivity

function getSession(messageId: string, userId: string): UserSession {
  const key = sessionKey(messageId, userId);
  let s = sessions.get(key);
  if (!s) {
    s = { yourItems: [], theirItems: [], lastSearch: { your: null, their: null }, touchedAt: Date.now() };
    sessions.set(key, s);
  } else {
    s.touchedAt = Date.now();
  }
  return s;
}

function clearSession(messageId: string, userId: string) {
  sessions.delete(sessionKey(messageId, userId));
}

function evictStaleSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, s] of sessions) {
    if (s.touchedAt < cutoff) sessions.delete(key);
  }
}

function sideField(session: UserSession, side: "your" | "their") {
  return side === "your" ? session.yourItems : session.theirItems;
}

function rarityEmoji(rarity: string): string {
  const map: Record<string, string> = {
    Common: "⚪",
    Rare: "🔵",
    Legendary: "🟡",
    Epic: "🟣",
    Exotic: "🔥",
    Limited: "💎",
  };
  return map[rarity] ?? "";
}

function formatItemLine(c: CalcItem): string {
  const val = calcItemValue(c);
  const rarity = c.item.rarity.map(rarityEmoji).join("") || "—";
  const starText = c.stars > 1 ? ` ${STAR_LABELS[c.stars]}` : "";
  const tierText = c.tier !== "mid" ? ` · ${c.tier}` : "";
  const qtyText = c.quantity > 1 ? ` x${c.quantity}` : "";
  return `${rarity} ${c.item.name}${qtyText}${tierText}${starText} — 💎 ${shortValue(val)}`;
}

function buildPreview(session: UserSession, description?: string): EmbedBuilder {
  const yourLines = session.yourItems.length > 0 ? session.yourItems.map(formatItemLine).join("\n") : EMPTY_SIDE;
  const theirLines = session.theirItems.length > 0 ? session.theirItems.map(formatItemLine).join("\n") : EMPTY_SIDE;
  const yourTotal = calcSideValue(session.yourItems);
  const theirTotal = calcSideValue(session.theirItems);
  const yourDemand = calcWeightedDemand(session.yourItems);
  const theirDemand = calcWeightedDemand(session.theirItems);

  return new EmbedBuilder()
    .setTitle("🧮 Vault Trade Calculator")
    .setColor(0x74cdd8)
    .setDescription(
      (description ? `${description}\n\n` : "") +
      `**Your offer** — 💎 ${shortValue(yourTotal)}${yourDemand != null ? ` · Demand ${yourDemand.toFixed(1)}/10` : ""}\n${yourLines}\n\n` +
      `**Their offer** — 💎 ${shortValue(theirTotal)}${theirDemand != null ? ` · Demand ${theirDemand.toFixed(1)}/10` : ""}\n${theirLines}`,
    )
    .setFooter({ text: "Prices from Vault Values" });
}

function buildMainComponents(messageId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:your:${messageId}`).setLabel("🙂 Your Items").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:their:${messageId}`).setLabel("🤝 Their Items").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:calc:${messageId}`).setLabel("🧮 Calculate").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:clear:${messageId}`).setLabel("🗑️ Clear").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildManageComponents(
  messageId: string,
  side: "your" | "their",
  userId: string,
  canAdd: boolean,
  hasItems: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const main = new ActionRowBuilder<ButtonBuilder>();
  if (canAdd) {
    main.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:add:${messageId}:${side}:${userId}`).setLabel("➕ Add Item").setStyle(ButtonStyle.Primary));
  }
  if (hasItems) {
    main.addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:remove:${messageId}:${side}:${userId}`).setLabel("🗑️ Remove").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:edit:${messageId}:${side}:${userId}`).setLabel("✏️ Edit").setStyle(ButtonStyle.Secondary),
    );
  }
  main.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:clear:${messageId}:${userId}`).setLabel("🚫 Clear All").setStyle(ButtonStyle.Danger));
  rows.push(main);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:back:${messageId}:${side}:${userId}`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildItemListComponents(
  messageId: string,
  side: "your" | "their",
  userId: string,
  items: CalcItem[],
  action: "remove" | "edit",
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  items.forEach((c, idx) => {
    const label = `${action === "remove" ? "🗑️" : "✏️"} ${idx + 1}. ${c.item.name.slice(0, 30)}`.slice(0, 80);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:${action}:${messageId}:${side}:${userId}:${idx}`)
        .setLabel(label)
        .setStyle(action === "remove" ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
  });
  return [
    row,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:back:${messageId}:${side}:${userId}`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildEditComponents(
  messageId: string,
  side: "your" | "their",
  userId: string,
  idx: number,
  item: CalcItem,
): ActionRowBuilder<ButtonBuilder>[] {
  const base = `${messageId}:${side}:${userId}:${idx}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:qty:${base}:label`).setLabel(`Qty: ${item.quantity}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`${PREFIX}:qty:${base}:inc`).setLabel("➕").setStyle(ButtonStyle.Primary).setDisabled(item.quantity >= 99),
      new ButtonBuilder().setCustomId(`${PREFIX}:qty:${base}:dec`).setLabel("➖").setStyle(ButtonStyle.Primary).setDisabled(item.quantity <= 1),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...TIER_CHOICES.map(tier =>
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:tier:${base}:${tier}`)
          .setLabel(tier === item.tier ? `✓ ${tier}` : tier)
          .setStyle(tier === item.tier ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...([1, 2, 3, 4, 5] as const).map(stars =>
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:stars:${base}:${stars}`)
          .setLabel(stars === item.stars ? `✓ ${STAR_LABELS[stars]}` : STAR_LABELS[stars])
          .setStyle(stars === item.stars ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:back:${messageId}:${side}:${userId}`).setLabel("↩️ Done").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:remove:${messageId}:${side}:${userId}:${idx}`).setLabel("🗑️ Delete this item").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildSearchResultComponents(
  messageId: string,
  side: "your" | "their",
  userId: string,
  results: MTTVItem[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let current = new ActionRowBuilder<ButtonBuilder>();
  results.forEach((item, idx) => {
    const rarity = item.rarity.map(rarityEmoji).join("") || "—";
    const label = `${rarity} ${item.name.slice(0, 80)}`.slice(0, 80);
    if (current.components.length >= 5) {
      rows.push(current);
      current = new ActionRowBuilder<ButtonBuilder>();
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:pick:${messageId}:${side}:${userId}:${idx}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    );
  });
  if (current.components.length > 0) rows.push(current);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:back:${messageId}:${side}:${userId}`).setLabel("↩️ Back").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

function buildAddModal(messageId: string, side: "your" | "their", userId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}_modal:add:${messageId}:${side}:${userId}`)
    .setTitle(side === "your" ? "Add to your offer" : "Add to their offer");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Item name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder("e.g. Super Tiger Mech or Exotic..."),
    ),
  );
  return modal;
}

function parseCustomId(customId: string): { action: string; parts: string[] } {
  const parts = customId.split(":");
  return { action: parts[1] ?? "", parts };
}

async function getRegisteredHub(messageId: string): Promise<CalculatorMessage | undefined> {
  return getCalculatorMessage(messageId);
}

// ── /postcalculator ───────────────────────────────────────────────────────────
export async function handlePostCalculator(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  // Note: caller (handleAdminCommand) already deferred the interaction ephemerally.

  // Server-side admin guard (slash default permissions are not enough).
  const isAuthorized =
    interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    (await isAdmin(interaction.guild.id, interaction.user.id));
  if (!isAuthorized) {
    await interaction.editReply("❌ Only admins can post a trade calculator.");
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    await interaction.editReply("❌ Choose a text channel.");
    return;
  }
  const textChannel = channel as GuildTextBasedChannel;

  const resultChannelRaw = interaction.options.getChannel("result_channel");
  const resultChannel =
    resultChannelRaw && (resultChannelRaw.type === ChannelType.GuildText || resultChannelRaw.type === ChannelType.GuildAnnouncement)
      ? (resultChannelRaw as GuildTextBasedChannel)
      : null;

  const me = interaction.guild.members.me;
  if (!me?.permissionsIn(textChannel).has(PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks)) {
    await interaction.editReply("❌ I don't have permission to send messages/embeds in the calculator channel.");
    return;
  }
  if (resultChannel && !me?.permissionsIn(resultChannel).has(PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks)) {
    await interaction.editReply("❌ I don't have permission to send messages/embeds in the result channel.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🧮 Vault Trade Calculator")
    .setColor(0x74cdd8)
    .setDescription(
      "Use the buttons below to build your trade offer.\n\n" +
      "• **Your Items** — add items you are giving\n" +
      "• **Their Items** — add items you are receiving\n" +
      "• **Calculate** — post the trade result publicly\n" +
      "• **Clear** — reset your session",
    )
    .setFooter({ text: "Prices from Vault Values · each user has their own private session" });

  try {
    const message = await textChannel.send({ embeds: [embed], components: buildMainComponents("placeholder") });
    const messageId = message.id;
    await message.edit({ components: buildMainComponents(messageId) });
    await createCalculatorMessage(interaction.guild.id, textChannel.id, messageId, interaction.user.id, resultChannel?.id ?? null);
    await interaction.editReply(`✅ Posted the calculator in ${textChannel.toString()}${resultChannel ? `; results will go to ${resultChannel.toString()}` : ""}.`);
  } catch (err) {
    logger.error({ err }, "Failed to post calculator");
    await interaction.editReply("❌ Could not post the calculator. Check my permissions.");
  }
}

// ── Button interactions ──────────────────────────────────────────────────────
export async function handleMttvHubButton(interaction: ButtonInteraction): Promise<void> {
  const { action, parts } = parseCustomId(interaction.customId);
  const messageId = parts[2];
  if (!messageId) return;

  evictStaleSessions();

  const hub = await getRegisteredHub(messageId);
  if (!hub) {
    await interaction.reply({
      content: "❌ This calculator hub is no longer registered. Ask an admin to post a new one with `/postcalculator`.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const userId = interaction.user.id;
  const session = getSession(messageId, userId);

  // Top-level hub buttons don't have the userId in the custom ID, so the side
  // and userId are derived differently.
  if (["your", "their", "calc", "clear"].includes(action)) {
    const side = action as "your" | "their" | "calc" | "clear";

    if (side === "calc") {
      await handleCalculate(interaction, session, hub);
      return;
    }

    if (side === "clear") {
      clearSession(messageId, userId);
      const fresh = getSession(messageId, userId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildPreview(fresh, "🧹 Your session has been reset.")],
        components: [],
      }).catch(() => {});
      return;
    }

    // your/their — open manage menu for that side.
    const items = sideField(session, side);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildPreview(session, `Managing **${side === "your" ? "Your" : "Their"}** items.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  // Deep-link buttons include userId at parts[4] (or parts[3] for back).
  const side = parts[3] as "your" | "their";
  if (!side) return;
  const deepUserId = parts[4];
  if (deepUserId && deepUserId !== userId) {
    await interaction.reply({
      content: "❌ This panel belongs to another user. Press a button on the main hub to start your own session.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const items = sideField(session, side);

  if (action === "back") {
    await interaction.update({
      embeds: [buildPreview(session, `Managing **${side === "your" ? "Your" : "Their"}** items.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  if (action === "add") {
    if (items.length >= MAX_ITEMS) {
      await interaction.reply({
        content: `❌ You can only add up to ${MAX_ITEMS} items per side.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
    await interaction.showModal(buildAddModal(messageId, side, userId));
    return;
  }

  if (action === "remove" || action === "edit") {
    const idx = parts[5] ? parseInt(parts[5], 10) : NaN;
    if (Number.isNaN(idx)) {
      // First click: show indexed item list so the user picks which item.
      if (items.length === 0) {
        await interaction.update({
          embeds: [buildPreview(session, "No items to modify on this side.")],
          components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
        }).catch(() => {});
        return;
      }
      await interaction.update({
        embeds: [buildPreview(session, `Select an item to **${action === "remove" ? "remove" : "edit"}**.`)],
        components: buildItemListComponents(messageId, side, userId, items, action),
      }).catch(() => {});
      return;
    }
    if (idx < 0 || idx >= items.length) {
      await interaction.update({
        embeds: [buildPreview(session, "⚠️ That item no longer exists. Pick another.")],
        components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
      }).catch(() => {});
      return;
    }
    if (action === "remove") {
      items.splice(idx, 1);
      await interaction.update({
        embeds: [buildPreview(session, "🗑️ Item removed.")],
        components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
      }).catch(() => {});
      return;
    }
    // edit
    await interaction.update({
      embeds: [buildPreview(session, `Editing **${items[idx].item.name}**.`)],
      components: buildEditComponents(messageId, side, userId, idx, items[idx]),
    }).catch(() => {});
    return;
  }

  if (action === "pick") {
    const idx = parseInt(parts[5], 10);
    const result = session.lastSearch[side]?.[idx];
    if (!result) {
      await interaction.update({
        embeds: [buildPreview(session, "⚠️ Search result expired. Try again.")],
        components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
      }).catch(() => {});
      return;
    }
    if (items.length >= MAX_ITEMS) {
      await interaction.update({
        embeds: [buildPreview(session, `❌ You can only add up to ${MAX_ITEMS} items per side.`)],
        components: buildManageComponents(messageId, side, userId, false, items.length > 0),
      }).catch(() => {});
      return;
    }
    items.push({ item: result, quantity: 1, tier: "mid", stars: 1 });
    session.lastSearch[side] = null;
    await interaction.update({
      embeds: [buildPreview(session, `✅ Added **${result.name}**. Adjust quantity/tier/stars below or add another.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  if (action === "qty" || action === "tier" || action === "stars") {
    const idx = parseInt(parts[5], 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= items.length) return;
    const item = items[idx];
    if (action === "qty") {
      const delta = parts[6] === "inc" ? 1 : -1;
      item.quantity = Math.max(1, Math.min(99, item.quantity + delta));
    } else if (action === "tier") {
      const tier = parts[6] as CalcTier;
      if (TIER_CHOICES.includes(tier)) item.tier = tier;
    } else if (action === "stars") {
      const stars = parseInt(parts[6], 10);
      if (!Number.isNaN(stars) && stars >= 1 && stars <= 5) item.stars = stars;
    }
    await interaction.update({
      embeds: [buildPreview(session, `Editing **${item.item.name}**.`)],
      components: buildEditComponents(messageId, side, userId, idx, item),
    }).catch(() => {});
    return;
  }
}

async function canUserPostIn(
  guild: import("discord.js").Guild,
  userId: string,
  channel: GuildTextBasedChannel,
): Promise<boolean> {
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return channel.permissionsFor(member).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
}

async function handleCalculate(
  interaction: ButtonInteraction,
  session: UserSession,
  hub: CalculatorMessage,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  if (session.yourItems.length === 0 || session.theirItems.length === 0) {
    await interaction.editReply({
      content: "❌ Add at least one item to both sides before calculating.",
    }).catch(() => {});
    return;
  }

  // Refresh latest MTTV data before calculating.
  let items: MTTVItem[];
  try {
    items = await fetchMTTVItems();
  } catch {
    await interaction.editReply({
      content: "❌ Could not fetch latest item values. Please try again.",
    }).catch(() => {});
    return;
  }

  const resolve = (c: CalcItem): CalcItem => {
    const latest = items.find(i => i.name.toLowerCase() === c.item.name.toLowerCase());
    return latest ? { ...c, item: latest } : c;
  };

  const your = session.yourItems.map(resolve);
  const their = session.theirItems.map(resolve);
  const yourTotal = calcSideValue(your);
  const theirTotal = calcSideValue(their);
  const yourDemand = calcWeightedDemand(your);
  const theirDemand = calcWeightedDemand(their);
  const diff = yourTotal - theirTotal;
  const rel = Math.abs(diff) / Math.max(yourTotal, theirTotal, 1);
  let verdict: string;
  let color: number;
  if (rel <= 0.05) {
    verdict = "⚖️ Fair trade";
    color = 0x95a5a6;
  } else if (diff > 0) {
    verdict = `🔴 You lose — their offer is short by 💎 ${shortValue(Math.abs(diff))}`;
    color = 0xe74c3c;
  } else {
    verdict = `🟢 You win — your offer is short by 💎 ${shortValue(Math.abs(diff))}`;
    color = 0x2ecc71;
  }

  const yourLines = your.map(formatItemLine).join("\n");
  const theirLines = their.map(formatItemLine).join("\n");
  const resultEmbed = new EmbedBuilder()
    .setTitle(`🧮 Trade Calculation — ${interaction.user.displayName || interaction.user.username}`)
    .setColor(color)
    .setDescription(
      `**Your offer** — 💎 ${shortValue(yourTotal)}${yourDemand != null ? ` · Demand ${yourDemand.toFixed(1)}/10` : ""}\n${yourLines}\n\n` +
      `**Their offer** — 💎 ${shortValue(theirTotal)}${theirDemand != null ? ` · Demand ${theirDemand.toFixed(1)}/10` : ""}\n${theirLines}\n\n` +
      `**Verdict:** ${verdict}`,
    )
    .setFooter({ text: "Prices from Vault Values" });

  try {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({
        content: "❌ Results can only be posted in a server. Here's your result:",
        embeds: [resultEmbed],
      }).catch(() => {});
      return;
    }

    const resolveChannel = async (channelId: string): Promise<GuildTextBasedChannel | null> => {
      const fetched = await guild.channels.fetch(channelId).catch(() => null);
      if (fetched && (fetched.type === ChannelType.GuildText || fetched.type === ChannelType.GuildAnnouncement)) {
        return fetched as GuildTextBasedChannel;
      }
      return null;
    };

    let targetChannel = await resolveChannel(hub.resultChannelId ?? hub.channelId);
    if (targetChannel && !(await canUserPostIn(guild, interaction.user.id, targetChannel))) {
      targetChannel = null;
    }

    if (!targetChannel) {
      const hubChannel = await resolveChannel(hub.channelId);
      if (hubChannel && await canUserPostIn(guild, interaction.user.id, hubChannel)) {
        targetChannel = hubChannel;
      }
    }

    if (targetChannel) {
      await targetChannel.send({ embeds: [resultEmbed] });
      await interaction.editReply({
        content: `✅ Posted your trade result in ${targetChannel.toString()}.`,
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: "❌ You don't have permission to post in the configured result channel, so here's your result:",
        embeds: [resultEmbed],
      }).catch(() => {});
    }
  } catch (err) {
    logger.error({ err }, "Failed to post calculator result");
    await interaction.editReply({
      content: "❌ Could not post the result. Please try again.",
    }).catch(() => {});
  }
}

// ── Modal submissions ──────────────────────────────────────────────────────────
export async function handleMttvHubModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts[0] !== `${PREFIX}_modal` || parts[1] !== "add") return;
  const messageId = parts[2];
  const side = parts[3] as "your" | "their";
  const userId = parts[4];
  if (!messageId || !side || !userId || userId !== interaction.user.id) return;

  // Acknowledge the modal submission immediately before doing any DB or
  // network work. Discord only gives us a 3-second window to respond.
  await interaction.deferUpdate().catch(() => {});

  evictStaleSessions();

  const hub = await getRegisteredHub(messageId);
  if (!hub) {
    await interaction.editReply({
      content: "❌ This calculator hub is no longer registered. Ask an admin to post a new one with `/postcalculator`.",
      embeds: [],
      components: [],
    }).catch(() => {});
    return;
  }

  const session = getSession(messageId, userId);
  const items = sideField(session, side);
  const nameRaw = interaction.fields.getTextInputValue("name").trim();

  if (items.length >= MAX_ITEMS) {
    await interaction.editReply({
      embeds: [buildPreview(session, `❌ You can only add up to ${MAX_ITEMS} items per side.`)],
      components: buildManageComponents(messageId, side, userId, false, items.length > 0),
    }).catch(() => {});
    return;
  }

  let allItems: MTTVItem[];
  try {
    allItems = await fetchMTTVItems();
  } catch {
    await interaction.editReply({
      embeds: [buildPreview(session, "❌ Could not fetch item values. Please try again.")],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  const exact = allItems.find(i => i.name.toLowerCase() === nameRaw.toLowerCase());
  if (exact) {
    items.push({ item: exact, quantity: 1, tier: "mid", stars: 1 });
    await interaction.editReply({
      embeds: [buildPreview(session, `✅ Added **${exact.name}**.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  const scored = allItems
    .map(i => ({ i, score: matchScore(i, nameRaw) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (scored.length === 0) {
    await interaction.editReply({
      embeds: [buildPreview(session, `❌ No items matched "${nameRaw}". Try a different name or acronym.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  if (scored.length === 1) {
    const match = scored[0].i;
    items.push({ item: match, quantity: 1, tier: "mid", stars: 1 });
    await interaction.editReply({
      embeds: [buildPreview(session, `✅ Added **${match.name}**.`)],
      components: buildManageComponents(messageId, side, userId, items.length < MAX_ITEMS, items.length > 0),
    }).catch(() => {});
    return;
  }

  session.lastSearch[side] = scored.map(s => s.i);
  const lines = scored.map((s, i) => {
    const rarity = s.i.rarity.map(rarityEmoji).join("") || "—";
    return `${i + 1}. ${rarity} **${s.i.name}** · 💰 ${formatMTTVValue(s.i)}`;
  }).join("\n");

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔍 Select an item")
        .setColor(0x9b59b6)
        .setDescription(`Search results for "${nameRaw}":\n${lines}`)
        .setFooter({ text: "Prices from Vault Values" }),
    ],
    components: buildSearchResultComponents(messageId, side, userId, scored.map(s => s.i)),
  }).catch(() => {});
}

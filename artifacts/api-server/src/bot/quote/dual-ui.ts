// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote UI — Target 2 Msgs flow (pick A → pick B → style → post/save).
// ─────────────────────────────────────────────────────────────────────────────

import type { Message } from "discord.js";
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, StringSelectMenuBuilder,
} from "discord.js";
import { BRAND_NAME } from "../help-banners.js";
import { DUAL_QUOTE_STYLES, getDualStyle } from "./dual-styles.js";
import { renderDualQuoteCard, DUAL_QUOTE_FILE } from "./render-dual.js";
import type { QuotePayload, QuoteSession } from "./session.js";
import { clip } from "./text.js";

const PREVIEW_NAME = "duo-preview.png";
const DISCORD_SHOT_NAME = "duo-discord-shot.png";

function dualStyleSelect(token: string, current: string) {
  return new StringSelectMenuBuilder()
    .setCustomId(`quote:dualstyle:${token}`)
    .setPlaceholder("Pick a dual style…")
    .addOptions(
      DUAL_QUOTE_STYLES.map(s => ({
        label: s.label.slice(0, 100),
        value: s.id,
        description: clip(s.description, 100),
        emoji: s.emoji,
        default: current === s.id,
      })),
    );
}

export function dualPickARows(token: string, messages: Message[]) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`quote:dualpicka:${token}`)
    .setPlaceholder("Pick message #1 (the setup)…")
    .addOptions(messages.map(m => {
      const name = m.member?.displayName ?? m.author.displayName ?? m.author.username;
      return {
        label: clip(`${name}: ${m.content}`, 100),
        value: m.id,
        description: clip(`@${m.author.username} · ${m.content}`, 100),
      };
    }));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`quote:dualcancel:${token}`).setLabel("Back to Single").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`quote:close:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function dualPickBRows(token: string, messages: Message[], excludeId?: string) {
  const filtered = messages.filter(m => m.id !== excludeId).slice(0, 5);
  if (!filtered.length) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`quote:dualcancel:${token}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`quote:close:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
      ),
    ];
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`quote:dualpickb:${token}`)
    .setPlaceholder("Pick message #2 (the reply / punchline)…")
    .addOptions(filtered.map(m => {
      const name = m.member?.displayName ?? m.author.displayName ?? m.author.username;
      return {
        label: clip(`${name}: ${m.content}`, 100),
        value: m.id,
        description: clip(`@${m.author.username} · ${m.content}`, 100),
      };
    }));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`quote:dualpicka-back:${token}`).setLabel("Re-pick #1").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`quote:close:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function dualBuilderRows(token: string, session: QuoteSession) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      dualStyleSelect(token, session.dualStyleId),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`quote:dualswap:${token}`).setLabel("Swap A ↔ B").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
      new ButtonBuilder().setCustomId(`quote:dualreroll:${token}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`quote:dualcancel:${token}`).setLabel("Back to Single").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`quote:dualpost:${token}`).setLabel("Post to Channel").setStyle(ButtonStyle.Success).setEmoji("📣"),
      new ButtonBuilder().setCustomId(`quote:dualsave:${token}`).setLabel("Save / Download").setStyle(ButtonStyle.Primary).setEmoji("💾"),
      new ButtonBuilder().setCustomId(`quote:close:${token}`).setLabel("Close").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function toDualLine(p: QuotePayload) {
  return {
    text: p.text,
    displayName: p.displayName,
    handle: p.handle,
    avatarUrl: p.avatarUrl,
    createdAt: p.createdAt,
  };
}

/** Render selected dual style + always a Discord-chat screenshot companion. */
export async function renderDualPreviews(session: QuoteSession): Promise<{
  main: Buffer | null;
  discordShot: Buffer | null;
}> {
  if (!session.payload || !session.payloadB) return { main: null, discordShot: null };
  const a = toDualLine(session.payload);
  const b = toDualLine(session.payloadB);
  const theme = getDualStyle(session.dualStyleId);
  const main = await renderDualQuoteCard({ a, b, theme, watermark: BRAND_NAME });
  session.lastPng = main ?? undefined;

  // Companion Discord screenshot when the chosen style isn't already that look.
  let discordShot: Buffer | null = null;
  if (theme.layout !== "duo-chat") {
    discordShot = await renderDualQuoteCard({
      a, b,
      theme: getDualStyle("duo-chat"),
      watermark: BRAND_NAME,
    });
    session.lastDiscordShot = discordShot ?? undefined;
  } else {
    session.lastDiscordShot = undefined;
  }
  return { main, discordShot };
}

export function buildDualPickAEmbed(count: number) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("💬 Target 2 Messages")
    .setDescription(
      count
        ? `**Step 1/2** — pick the **setup** message (what they said first).\nShowing the last **${count}** text messages.`
        : "No recent text messages found in this channel.",
    )
    .setFooter({ text: `${BRAND_NAME} · fuse two lines into one funny card` });
}

export function buildDualPickBEmbed(a: QuotePayload) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("💬 Target 2 Messages")
    .setDescription(
      `**Step 2/2** — pick the **reply / punchline**.\n\n` +
      `**#1 setup:** ${a.displayName}: “${clip(a.text, 120)}”`,
    )
    .setFooter({ text: `${BRAND_NAME} · then pick a dual style` });
}

export async function buildDualBuilderReply(token: string, session: QuoteSession) {
  const theme = getDualStyle(session.dualStyleId);
  const { main, discordShot } = await renderDualPreviews(session);
  const a = session.payload;
  const b = session.payloadB;

  const embed = new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(`${theme.emoji} Dual Quote · ${theme.label}`)
    .setDescription(
      `**${a?.displayName ?? "?"}** said… then **${b?.displayName ?? "?"}** came back.\n` +
      `Style: **${theme.label}** — ${theme.description}\n\n` +
      (discordShot
        ? "📸 Scroll down — Discord chat screenshot of both msgs is below."
        : "💬 This style *is* the Discord chat screenshot."),
    )
    .setFooter({ text: `${BRAND_NAME} · ayoo they really said that` });

  const files: AttachmentBuilder[] = [];
  const embeds: EmbedBuilder[] = [embed];
  if (main) {
    files.push(new AttachmentBuilder(main, { name: PREVIEW_NAME }));
    embed.setImage(`attachment://${PREVIEW_NAME}`);
  }
  if (discordShot) {
    files.push(new AttachmentBuilder(discordShot, { name: DISCORD_SHOT_NAME }));
    embeds.push(
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("💬 Discord chat screenshot")
        .setDescription("The raw exchange — how it looked in chat.")
        .setImage(`attachment://${DISCORD_SHOT_NAME}`),
    );
  }

  return {
    embeds,
    components: dualBuilderRows(token, session),
    files,
  };
}

export function dualPostFiles(session: QuoteSession): AttachmentBuilder[] {
  const files: AttachmentBuilder[] = [];
  if (session.lastPng) {
    files.push(new AttachmentBuilder(session.lastPng, { name: DUAL_QUOTE_FILE }));
  }
  if (session.lastDiscordShot) {
    files.push(new AttachmentBuilder(session.lastDiscordShot, { name: DISCORD_SHOT_NAME }));
  }
  return files;
}

/** Public channel post: caption + styled card embed, plus Discord-shot embed when present. */
export function dualPostPayload(session: QuoteSession): {
  content: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
} {
  const files = dualPostFiles(session);
  const theme = getDualStyle(session.dualStyleId);
  const embeds: EmbedBuilder[] = [];
  if (session.lastPng) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x111111)
        .setTitle(`${theme.emoji} Dual Quote · ${theme.label}`)
        .setImage(`attachment://${DUAL_QUOTE_FILE}`)
        .setFooter({ text: dualPostCaption(session).replace(/\*\*/g, "") }),
    );
  }
  if (session.lastDiscordShot) {
    embeds.push(
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("💬 Discord chat screenshot")
        .setImage(`attachment://${DISCORD_SHOT_NAME}`),
    );
  }
  return { content: dualPostCaption(session), embeds, files };
}

export function dualPostCaption(session: QuoteSession): string {
  const a = session.payload?.displayName ?? "someone";
  const b = session.payloadB?.displayName ?? "someone";
  return `💬 **Dual Quote** — ${a} → ${b}`;
}

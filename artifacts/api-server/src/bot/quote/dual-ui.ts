// ─────────────────────────────────────────────────────────────────────────────
// Dual-quote UI — Target 2 Msgs flow.
// Each slot (A then B) gets a full source hub: recent msgs / by user /
// message ID / custom text — same power as single /quote, in two steps.
// ─────────────────────────────────────────────────────────────────────────────

import type { Message } from "discord.js";
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder,
} from "discord.js";
import { BRAND_NAME } from "../help-banners.js";
import { DUAL_QUOTE_STYLES, getDualStyle } from "./dual-styles.js";
import { renderDualQuoteCard, DUAL_QUOTE_FILE } from "./render-dual.js";
import type { QuotePayload, QuoteSession } from "./session.js";
import { clip } from "./text.js";

const PREVIEW_NAME = "duo-preview.png";
const DISCORD_SHOT_NAME = "duo-discord-shot.png";

export type DualSlot = "a" | "b";

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

/** Render selected dual style + Classic companion when needed. */
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

  let discordShot: Buffer | null = null;
  if (theme.layout !== "duo-classic") {
    discordShot = await renderDualQuoteCard({
      a, b,
      theme: getDualStyle("duo-classic"),
      watermark: BRAND_NAME,
    });
    session.lastDiscordShot = discordShot ?? undefined;
  } else {
    session.lastDiscordShot = undefined;
  }
  return { main, discordShot };
}

export function dualSlotFromView(session: QuoteSession): DualSlot {
  return session.view === "dual-pick-b" ? "b" : "a";
}

/** Full source hub for message #1 or #2 — recent / user / ID / custom. */
export function buildDualHubEmbed(session: QuoteSession, messageCount: number): EmbedBuilder {
  const slot = dualSlotFromView(session);
  const step = slot === "a" ? "1/2" : "2/2";
  const role = slot === "a" ? "**setup** (what they said first)" : "**reply / punchline**";
  const filter = session.dualFilterUserId
    ? `\nFiltering to **${session.dualFilterUserName ?? "member"}**'s recent msgs.`
    : "";
  const lockedA = slot === "b" && session.payload
    ? `\n\n**#1 locked in:** ${session.payload.displayName}: “${clip(session.payload.text, 100)}”`
    : "";

  let body: string;
  if (messageCount) {
    body =
      `**Step ${step}** — pick the ${role}.\n` +
      `Same options as a single quote: recent msgs, a member, a message ID, or custom text.` +
      filter + lockedA;
  } else {
    body =
      `**Step ${step}** — pick the ${role}.\n` +
      (session.dualFilterUserId
        ? `No recent text from **${session.dualFilterUserName ?? "that member"}** — try Message ID or Custom Text.`
        : "No recent text messages here — use Message ID or Custom Text.") +
      filter + lockedA;
  }

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(slot === "a" ? "💬 Target 2 Messages · Setup" : "💬 Target 2 Messages · Reply")
    .setDescription(body)
    .setFooter({ text: `${BRAND_NAME} · fuse two lines into one funny card` });
}

export function dualHubRows(token: string, session: QuoteSession, messages: Message[]) {
  const slot = dualSlotFromView(session);
  const pickId = slot === "a" ? `quote:dualpicka:${token}` : `quote:dualpickb:${token}`;
  const rows: ActionRowBuilder<StringSelectMenuBuilder | UserSelectMenuBuilder | ButtonBuilder>[] = [];

  if (messages.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(pickId)
      .setPlaceholder(
        session.dualFilterUserId
          ? `Pick from ${session.dualFilterUserName ?? "member"}'s recent msgs…`
          : slot === "a"
            ? "Pick setup from recent msgs…"
            : "Pick reply from recent msgs…",
      )
      .addOptions(messages.slice(0, 5).map(m => {
        const name = m.member?.displayName ?? m.author.displayName ?? m.author.username;
        return {
          label: clip(`${name}: ${m.content}`, 100),
          value: m.id,
          description: clip(`@${m.author.username} · ${m.content}`, 100),
        };
      }));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  rows.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`quote:dualuser:${token}`)
        .setPlaceholder("Or pick a member → their last msgs…")
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  const toolBtns = [
    new ButtonBuilder().setCustomId(`quote:dualmsgid:${token}`).setLabel("Message ID").setStyle(ButtonStyle.Secondary).setEmoji("🔢"),
    new ButtonBuilder().setCustomId(`quote:dualcustom:${token}`).setLabel("Custom Text").setStyle(ButtonStyle.Secondary).setEmoji("✏️"),
  ];
  if (session.dualFilterUserId) {
    toolBtns.push(
      new ButtonBuilder().setCustomId(`quote:dualclearuser:${token}`).setLabel("Clear User Filter").setStyle(ButtonStyle.Secondary),
    );
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...toolBtns));

  const nav: ButtonBuilder[] = [];
  if (slot === "b") {
    nav.push(new ButtonBuilder().setCustomId(`quote:dualpicka-back:${token}`).setLabel("Re-pick #1").setStyle(ButtonStyle.Secondary));
  } else {
    nav.push(new ButtonBuilder().setCustomId(`quote:dualcancel:${token}`).setLabel("Back to Single").setStyle(ButtonStyle.Secondary));
  }
  nav.push(new ButtonBuilder().setCustomId(`quote:close:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...nav));

  return rows;
}

/** @deprecated kept as thin wrappers for older call sites */
export function dualPickARows(token: string, messages: Message[], session?: QuoteSession) {
  const fake = session ?? { view: "dual-pick-a", dualFilterUserId: null } as QuoteSession;
  fake.view = "dual-pick-a";
  return dualHubRows(token, fake, messages);
}

export function dualPickBRows(token: string, messages: Message[], session?: QuoteSession, _excludeId?: string) {
  const fake = session ?? { view: "dual-pick-b", dualFilterUserId: null, payload: null } as QuoteSession;
  fake.view = "dual-pick-b";
  return dualHubRows(token, fake, messages);
}

export function buildDualPickAEmbed(count: number) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("💬 Target 2 Messages · Setup")
    .setDescription(
      `**Step 1/2** — pick the **setup**.\n` +
      (count
        ? `Recent msgs below, or pick a member / message ID / custom text.`
        : "No recent text — use Message ID or Custom Text."),
    )
    .setFooter({ text: `${BRAND_NAME} · fuse two lines into one funny card` });
}

export function buildDualPickBEmbed(a: QuotePayload) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("💬 Target 2 Messages · Reply")
    .setDescription(
      `**Step 2/2** — pick the **reply / punchline**.\n\n` +
      `**#1 setup:** ${a.displayName}: “${clip(a.text, 120)}”\n` +
      `Same options: recent msgs, member, message ID, or custom text.`,
    )
    .setFooter({ text: `${BRAND_NAME} · then pick a dual style` });
}

export function buildDualHubReply(
  token: string,
  session: QuoteSession,
  messages: Message[],
) {
  return {
    embeds: [buildDualHubEmbed(session, messages.length)],
    components: dualHubRows(token, session, messages),
    files: [] as AttachmentBuilder[],
  };
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
        ? "📸 Scroll down — Classic Discord look of both msgs is below."
        : "🖤 Classic is the clean Discord dual look."),
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
        .setTitle("🖤 Classic companion")
        .setDescription("Clean Discord dual of the same two msgs.")
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
        .setTitle("🖤 Classic companion")
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

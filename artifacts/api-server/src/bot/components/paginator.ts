import {
  type ChatInputCommandInteraction,
  type Message,
  type MessageActionRowComponentBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { selectMenuEmoji } from "../cards-data.js";

export interface PaginatorView {
  key: string;
  label: string;
  emoji?: string;
  description?: string;
  screens: EmbedBuilder[];
}

export interface PaginatorOpts {
  interaction: ChatInputCommandInteraction;
  views: PaginatorView[];
  initialKey?: string;
  ownerId: string;
  idleMs?: number;
}

// Generic overview→drill-down paginator. Views appear in a string select;
// multi-screen views (>24 fields) get ◀/▶ buttons; non-overview views get a
// "🏠 Overview" jump button. Locked to the invoking user; non-owner clicks
// get an ephemeral "run it yourself" reply. On idle timeout, components are
// disabled in place so the message stays readable.
export async function runPaginator(opts: PaginatorOpts): Promise<void> {
  const { interaction, views, ownerId } = opts;
  const idleMs = opts.idleMs ?? 5 * 60 * 1000;
  if (views.length === 0) return;
  // Defensive: a view with zero screens would crash on `screens[0]!`. Drop
  // any such views so future callers can't accidentally brick the paginator.
  const safeViews = views.filter(v => v.screens.length > 0);
  if (safeViews.length === 0) return;

  const overviewKey = safeViews[0]!.key;
  let viewKey = opts.initialKey && safeViews.some(v => v.key === opts.initialKey)
    ? opts.initialKey
    : overviewKey;
  let screenIdx = 0;

  const currentView = () => safeViews.find(v => v.key === viewKey) ?? safeViews[0]!;

  const build = (disabled = false): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  } => {
    const v = currentView();
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

    if (safeViews.length > 1) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("pg:view")
        .setPlaceholder("Jump to a section…")
        .setDisabled(disabled)
        .addOptions(
          safeViews.slice(0, 25).map(v2 => {
            const opt: {
              label: string; value: string; default: boolean;
              description?: string; emoji?: string;
            } = {
              label: v2.label.slice(0, 100),
              value: v2.key,
              default: v2.key === viewKey,
            };
            if (v2.description) opt.description = v2.description.slice(0, 100);
            // Discord.js 14 requires emoji as an object, not a raw string.
            // Custom emoji shortcodes (e.g. :yellow_heart:) are invalid here.
            if (v2.emoji) (opt as Record<string, unknown>).emoji = selectMenuEmoji(v2.emoji, "🃏");
            return opt;
          }),
        );
      rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
    }

    const navButtons: ButtonBuilder[] = [];
    if (viewKey !== overviewKey) {
      navButtons.push(
        new ButtonBuilder()
          .setCustomId("pg:back")
          .setLabel("Overview")
          .setEmoji("🏠")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      );
    }
    if (v.screens.length > 1) {
      navButtons.push(
        new ButtonBuilder()
          .setCustomId("pg:prev")
          .setEmoji("◀️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || screenIdx === 0),
        new ButtonBuilder()
          .setCustomId("pg:page")
          .setLabel(`${screenIdx + 1} / ${v.screens.length}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("pg:next")
          .setEmoji("▶️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || screenIdx >= v.screens.length - 1),
      );
    }
    if (navButtons.length > 0) {
      rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...navButtons));
    }

    return { embeds: [v.screens[screenIdx]!], components: rows };
  };

  const message = (await interaction.editReply(build())) as Message;

  // Two collectors so non-owner clicks can't refresh the owner's idle window:
  //   • ownerCollector: filtered to invoker, has `idle` — drives nav + timeout.
  //   • guestCollector: everyone else, no idle/time — only sends the ephemeral
  //     "run it yourself" reply. Lives as long as the owner's view is active
  //     and is stopped explicitly on owner-collector end.
  const ownerCollector = message.createMessageComponentCollector({
    idle: idleMs,
    filter: (i) => i.user.id === ownerId,
  });
  const guestCollector = message.createMessageComponentCollector({
    filter: (i) => i.user.id !== ownerId,
  });

  guestCollector.on("collect", async (i) => {
    await i.reply({
      content: "Run the command yourself to navigate your own view.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  });

  ownerCollector.on("collect", async (i) => {
    if (i.customId === "pg:view" && i.componentType === ComponentType.StringSelect) {
      viewKey = i.values[0]!;
      screenIdx = 0;
    } else if (i.customId === "pg:back") {
      viewKey = overviewKey;
      screenIdx = 0;
    } else if (i.customId === "pg:prev") {
      screenIdx = Math.max(0, screenIdx - 1);
    } else if (i.customId === "pg:next") {
      screenIdx = Math.min(currentView().screens.length - 1, screenIdx + 1);
    } else {
      await i.deferUpdate().catch(() => {});
      return;
    }
    await i.update(build()).catch(() => {});
  });

  ownerCollector.on("end", async () => {
    guestCollector.stop();
    await interaction.editReply(build(true)).catch(() => {});
  });
}

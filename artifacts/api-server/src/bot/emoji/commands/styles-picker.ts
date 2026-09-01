// ─────────────────────────────────────────────────────────────────────────────
// Visual style browser for /emoji.
//
// Replaces the truncated 25-option animation dropdown with a paginated picker
// that shows MakeEmoji's prerendered cat preview for the focused style, lets
// users search by name, and remembers per-user favorites.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  AttachmentBuilder,
  TextInputBuilder, TextInputStyle, type APIEmbed,
} from "discord.js";
import { fuzzyRank } from "../../search/fuse-service.js";
import { getManifest } from "../providers/makeemoji/manifest.js";
import { isFavorite, listFavorites } from "./favorites.js";
import { resolveStylePreviewUrl } from "./previews.js";
import { prefetchStylePreviews, renderStylePreview } from "../preview/index.js";
import { renderBoard, BOARD_PAGE_SIZE, BOARD_FILENAME } from "./board.js";
import type { EmojiSession } from "./session.js";
import { cid } from "./ui.js";

/** Attachment name the animated focus preview points at with `attachment://`. */
const PREVIEW_FILENAME = "style-preview.gif";

/**
 * Styles per board page. One source of truth so the canvas grid, the number
 * picker, and pagination all agree.
 */
export const STYLES_PAGE_SIZE = BOARD_PAGE_SIZE;

/** Max search query length in the modal. */
export const MAX_STYLE_QUERY = 40;

export interface StyleEntry {
  value: string;
  label: string;
}

/** Payload shape accepted by interaction.editReply for the style browser. */
export interface StylesPickerReply {
  content: string;
  embeds: (EmbedBuilder | APIEmbed)[];
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
  files: AttachmentBuilder[];
}

/** Every animation the live manifest currently offers. */
export function allStyles(): StyleEntry[] {
  const values = getManifest().manifest?.controls.animation?.values ?? [];
  const rows = values.map(v => ({
    value: v.value,
    label: (v.label && v.label.trim()) || v.value,
  }));
  // MakeEmoji opens on `none` so Colour can animate the image alone — keep it first.
  rows.sort((a, b) => {
    const aNone = /^(gen_btn_)?none$/i.test(a.value) || /^none$/i.test(a.label) ? 0 : 1;
    const bNone = /^(gen_btn_)?none$/i.test(b.value) || /^none$/i.test(b.label) ? 0 : 1;
    if (aNone !== bNone) return aNone - bNone;
    return a.label.localeCompare(b.label);
  });
  return rows;
}

export function findStyle(value: string): StyleEntry | undefined {
  return allStyles().find(s => s.value === value);
}

/** Filter + page the catalog for the current session picker state. */
export function pageStyles(session: EmojiSession, userId: string): {
  rows: StyleEntry[];
  page: number;
  pages: number;
  total: number;
} {
  const favs = new Set(listFavorites(userId));
  let rows = allStyles();

  if (session.styleFilter === "favorites") {
    rows = rows.filter(s => favs.has(s.value));
    // Keep the user's favorite order (most recent first).
    const order = listFavorites(userId);
    rows.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  }

  const query = session.styleQuery?.trim() ?? "";
  if (query) {
    rows = fuzzyRank(rows, query, s => s.label);
  }

  const pages = Math.max(1, Math.ceil(rows.length / STYLES_PAGE_SIZE));
  const page = Math.min(Math.max(0, session.stylePage ?? 0), pages - 1);
  const slice = rows.slice(page * STYLES_PAGE_SIZE, (page + 1) * STYLES_PAGE_SIZE);
  return { rows: slice, page, pages, total: rows.length };
}

/** Ensure the session has a sensible focused style for the current page. */
export function ensureStyleFocus(session: EmojiSession, userId: string): string {
  const { rows } = pageStyles(session, userId);
  const focus = session.styleFocus;
  if (focus && rows.some(r => r.value === focus)) return focus;
  if (focus && findStyle(focus)) return focus;
  // Prefer the currently applied animation when it's on this page / catalog.
  if (rows.some(r => r.value === session.animation)) return session.animation;
  return rows[0]?.value ?? session.animation;
}

/** Modal for name search. */
export function buildStyleSearchModal(token: string, currentQuery: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("styles_modal", token))
    .setTitle("Search styles by name")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Style name (leave empty to clear)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(MAX_STYLE_QUERY)
          .setValue(currentQuery.slice(0, MAX_STYLE_QUERY)),
      ),
    );
}

/**
 * The Style Board dashboard.
 *
 * The embed's main image is a canvas contact sheet of this page's styles, each
 * rendered on the user's own image and numbered. The focused style also rides
 * along as an animated thumbnail, so the board shows "all of them at once" and
 * "this one, moving" together. A numbered dropdown and a highlighting number
 * picker choose a style; nothing regenerates until **Apply**, so browsing is
 * instant.
 */
export async function buildStylesPicker(
  session: EmojiSession,
  token: string,
): Promise<StylesPickerReply> {
  const userId = session.ownerId;
  const focusValue = ensureStyleFocus(session, userId);
  session.styleFocus = focusValue;

  const focused = findStyle(focusValue);
  const label = focused?.label ?? focusValue;
  const { rows, page, pages, total } = pageStyles(session, userId);
  const favorited = isFavorite(userId, focusValue);
  const targetLabel = session.sourceLabel ?? "your image";
  const focusIndex = rows.findIndex(r => r.value === focusValue);

  // Warm the animated previews for this page so focusing feels instant.
  if (session.image) prefetchStylePreviews(session.image, rows.map(r => r.value));

  // The board (main image) and the focused animated preview (thumbnail) are the
  // two pictures. Both are rendered on the user's OWN image; the CDN cat is only
  // a last-resort thumbnail when a style can't be drawn locally.
  const board = session.image
    ? await renderBoard({
        image: session.image,
        targetLabel,
        styles: rows,
        focusValue,
        userId,
        page,
        pages,
        total,
        format: session.format,
      })
    : null;
  const livePreview = session.image
    ? await renderStylePreview(session.image, focusValue)
    : null;
  const previewUrl = livePreview
    ? null
    : focused ? await resolveStylePreviewUrl(focused.label) : null;

  const filters: string[] = [];
  if (session.styleFilter === "favorites") filters.push("★ favorites");
  if (session.styleQuery?.trim()) filters.push(`search “${session.styleQuery.trim()}”`);

  const numbered = focusIndex >= 0 ? `#${focusIndex + 1} · ` : "";
  const embed = new EmbedBuilder()
    .setColor(favorited ? 0xf1c40f : 0x5865f2)
    .setAuthor({ name: `🎯 ${targetLabel}` })
    .setTitle("🎨 Style Board")
    .setDescription([
      `Selected: **${numbered}${label}** ${favorited ? "★" : ""}`.trim(),
      `\`${focusValue}\` · type \`${session.format.toUpperCase()}\``,
      "",
      "Tap a **number** below (or the dropdown) to select — the board rings your pick.",
      "**Apply** renders it at full quality on your target.",
    ].join("\n"))
    .setFooter({
      text: [
        `${total} style${total === 1 ? "" : "s"}`,
        filters.length ? filters.join(" · ") : "all styles",
        `page ${page + 1}/${pages}`,
      ].join(" · "),
    });

  const files: AttachmentBuilder[] = [];

  if (board) {
    files.push(new AttachmentBuilder(board, { name: BOARD_FILENAME }));
    embed.setImage(`attachment://${BOARD_FILENAME}`);
  }

  if (livePreview) {
    // Attached rather than linked: the bytes were rendered here and now.
    files.push(new AttachmentBuilder(livePreview, { name: PREVIEW_FILENAME }));
    embed.setThumbnail(`attachment://${PREVIEW_FILENAME}`);
  } else if (previewUrl) {
    embed.setThumbnail(previewUrl);
  }

  if (!board && !livePreview && !previewUrl) {
    embed.addFields({
      name: "Preview",
      value: "_No preview for this style — Apply still works._",
    });
  }

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  // Row: numbered jump dropdown — labels the same styles the board shows.
  if (rows.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(cid("styles_pick", token))
      .setPlaceholder(`Page ${page + 1}/${pages} — jump to a style`)
      .addOptions(rows.map((s, i) => {
        const star = isFavorite(userId, s.value) ? "★ " : "";
        const applied = s.value === session.animation ? " · in use" : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${i + 1} · ${star}${s.label}`.slice(0, 100))
          .setDescription(`${s.value}${applied}`.slice(0, 100))
          .setValue(s.value.slice(0, 100))
          .setDefault(s.value === focusValue);
      }));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }

  // Rows: the number picker. Discord caps a row at five buttons, so 1-4 sit on
  // one row and 5-8 on the next. The selected number is the only Primary button,
  // matching the ring the board draws around that cell.
  for (let start = 0; start < rows.length; start += 4) {
    const chunk = rows.slice(start, start + 4);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...chunk.map((s, j) => {
        const index = start + j;
        return new ButtonBuilder()
          .setCustomId(cid(`styles_n${index}`, token))
          .setLabel(String(index + 1))
          .setStyle(index === focusIndex ? ButtonStyle.Primary : ButtonStyle.Secondary);
      }),
    );
    components.push(row);
  }

  // Row: navigation + browse filters + change target.
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(cid("styles_prev", token))
        .setEmoji("◀️")
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(cid("styles_next", token))
        .setEmoji("▶️")
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
      new ButtonBuilder()
        .setCustomId(cid("styles_search", token))
        .setLabel(session.styleQuery?.trim() ? `Search: ${session.styleQuery.trim()}`.slice(0, 60) : "Search")
        .setEmoji("🔍")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(cid("styles_filter", token))
        .setLabel(session.styleFilter === "favorites" ? "Show all" : "Favorites")
        .setEmoji("⭐")
        .setStyle(session.styleFilter === "favorites" ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid("styles_target", token))
        .setLabel("Target")
        .setEmoji("🎯")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  // Row: act on the focused style.
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(cid("styles_fav", token))
        .setLabel(favorited ? "Unfavorite" : "Favorite")
        .setEmoji(favorited ? "☆" : "⭐")
        .setStyle(favorited ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(!focused),
      new ButtonBuilder()
        .setCustomId(cid("styles_apply", token))
        .setLabel("Apply style")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!focused),
      new ButtonBuilder()
        .setCustomId(cid("styles_back", token))
        .setLabel("Back")
        .setEmoji("↩️")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    content: "",
    embeds: [embed],
    components,
    files,
  };
}

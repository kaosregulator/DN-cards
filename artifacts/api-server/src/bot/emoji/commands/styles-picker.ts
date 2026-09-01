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
import type { EmojiSession } from "./session.js";
import { cid } from "./ui.js";

/** Attachment name the embed points at with `attachment://`. */
const PREVIEW_FILENAME = "style-preview.gif";

/** Styles per select page — Discord caps at 25; leave headroom for labels. */
export const STYLES_PAGE_SIZE = 20;

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
 * Full picker message: embed with CDN preview + paginated select + nav.
 * Does not regenerate the user's emoji — browsing is instant.
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
  // Prefer a preview rendered on the user's OWN image — that is the question
  // they are actually asking. MakeEmoji's prerendered cat is the fallback for
  // styles the offline engine cannot draw, so browsing never loses its picture.
  // The browser is only ever shown after a target is chosen, so image is set;
  // the guard keeps the type honest.
  const livePreview = session.image
    ? await renderStylePreview(session.image, focusValue)
    : null;
  const previewUrl = livePreview
    ? null
    : focused ? await resolveStylePreviewUrl(focused.label) : null;

  // Warm the styles on this page so paging feels instant rather than rendering
  // one at a time as the user clicks.
  if (session.image) prefetchStylePreviews(session.image, rows.map(r => r.value));

  const filters: string[] = [];
  if (session.styleFilter === "favorites") filters.push("★ favorites");
  if (session.styleQuery?.trim()) filters.push(`search “${session.styleQuery.trim()}”`);

  const embed = new EmbedBuilder()
    .setColor(favorited ? 0xf1c40f : 0x5865f2)
    .setTitle("Style browser")
    .setDescription([
      `Previewing **${label}**`,
      `\`${focusValue}\``,
      favorited ? "★ Saved in your favorites" : "☆ Not in favorites yet",
      "",
      livePreview
        ? "This is **your image** with this style. **Apply** generates it at full quality."
        : "Preview shown on MakeEmoji's sample image. **Apply** runs it on your image.",
      "Remember the name — you can type it in `/emoji animation` later.",
    ].join("\n"))
    .setFooter({
      text: [
        `${total} style${total === 1 ? "" : "s"}`,
        filters.length ? filters.join(" · ") : "all styles",
        `page ${page + 1}/${pages}`,
      ].join(" · "),
    });

  const files: AttachmentBuilder[] = [];

  if (livePreview) {
    // Attached rather than linked: the bytes were rendered here and now.
    files.push(new AttachmentBuilder(livePreview, { name: PREVIEW_FILENAME }));
    embed.setImage(`attachment://${PREVIEW_FILENAME}`);
  } else if (previewUrl) {
    embed.setImage(previewUrl);
  } else {
    embed.addFields({
      name: "Preview",
      value: "_No preview for this style — Apply still works._",
    });
  }

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  if (rows.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(cid("styles_pick", token))
      .setPlaceholder(`Page ${page + 1}/${pages} — choose a style to preview`)
      .addOptions(rows.map(s => {
        const star = isFavorite(userId, s.value) ? "★ " : "";
        const applied = s.value === session.animation ? " · in use" : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${star}${s.label}`.slice(0, 100))
          .setDescription(`${s.value}${applied}`.slice(0, 100))
          .setValue(s.value.slice(0, 100))
          .setDefault(s.value === focusValue);
      }));
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(cid("styles_prev", token))
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(cid("styles_next", token))
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1),
      new ButtonBuilder()
        .setCustomId(cid("styles_search", token))
        .setLabel(session.styleQuery?.trim() ? `Search: ${session.styleQuery.trim()}`.slice(0, 80) : "Search")
        .setEmoji("🔍")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(cid("styles_filter", token))
        .setLabel(session.styleFilter === "favorites" ? "Show all" : "Favorites")
        .setEmoji("⭐")
        .setStyle(session.styleFilter === "favorites" ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(cid("styles_fav", token))
        .setLabel(favorited ? "Unfavorite" : "Favorite")
        .setEmoji("⭐")
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

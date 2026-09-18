// ─────────────────────────────────────────────────────────────────────────────
// /emoji control panel.
//
// Every picker is built from the discovery manifest, so the panel shows exactly
// what MakeEmoji offers. Animation is *not* a truncated select of 25 — with
// ~473 styles that would hide most of the catalog. Instead a "Browse Styles"
// button opens the visual style browser (search, pages, favorites, CDN preview).
//
// Discord allows five action rows, so the panel keeps the last row for format
// and Done, and spends the rest on the most useful secondary controls.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType,
  FileUploadBuilder, LabelBuilder, ModalBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from "discord.js";
import { createHash } from "node:crypto";
import { getManifest } from "../providers/makeemoji/manifest.js";
import { isSceneAnimation, sceneLabelOf } from "../providers/offline/scene-pack.js";
import type { OptionKey } from "../providers/makeemoji/types.js";
import type { EmojiFormat } from "../types.js";
import { FORMATS, extensionFor } from "../utils/options.js";
import type { EmojiSession } from "./session.js";

/**
 * Attachment name for a generated result, tagged with a short content hash.
 *
 * Discord caches an attachment by filename within an edited message, so a
 * constant `emoji.gif` made a re-render (a new target, a new style) keep showing
 * the *previous* image. Varying the name by content forces the client to fetch
 * the new bytes, while identical bytes reuse the same name (and cache) harmlessly.
 */
export function resultFileName(buffer: Buffer, format: EmojiFormat): string {
  const tag = createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  return `emoji-${tag}.${extensionFor(format)}`;
}

/** One-line hint on how to save or share the result — shown on the preview. */
export const RESULT_HINT =
  "-# Tap the preview to open it · press-and-hold (mobile) or right-click (desktop) to save · **Post** drops it into a channel.";

/** Same as RESULT_HINT but without Post — used by the shared channel postboard. */
export const RESULT_HINT_SAVE_ONLY =
  "-# Tap the preview to open it · press-and-hold (mobile) or right-click (desktop) to save.";

/** Hint line for the current session (Post only when the flow allows it). */
export function resultHint(session: EmojiSession): string {
  return session.allowPost !== false ? RESULT_HINT : RESULT_HINT_SAVE_ONLY;
}

/**
 * Opening screen: what do you want to animate?
 *
 * This is the first thing `/emoji` shows. Three targets, each one click:
 *   • User   — a native member picker (defaults to the caller, picks anyone)
 *   • Image  — the Discord upload modal
 *   • Server — the guild's own icon
 *
 * Picking any of them loads the source and drops straight into the style
 * browser, so the whole flow is target → styles → generate with no menus in
 * between.
 *
 * The same layout is posted publicly by `/postboard` with {@link BOARD_TOKEN}:
 * each clicker gets their own private session so many people can use one board
 * at once without stealing each other's controls.
 */
export function buildTargetChooser(token: string) {
  const memberRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(cid("pick_user", token))
      .setPlaceholder("👤 Animate a member — pick anyone (default: you)")
      .setMinValues(1)
      .setMaxValues(1),
  );

  const otherRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid("pick_me", token))
      .setLabel("My avatar")
      .setEmoji("🙂")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("upload", token))
      .setLabel("Upload image")
      .setEmoji("🖼️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("pick_server", token))
      .setLabel("Server icon")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("pick_fav", token))
      .setLabel("Favorites")
      .setEmoji("⭐")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: [
      "## 🎨 Make an emoji",
      "**What do you want to animate?**",
      "-# Pick a member below, or use your own avatar, an uploaded image, or this server's icon.",
      "-# ⭐ **Favorites** jumps straight to your starred styles on your avatar — tap **Target** there to switch subject.",
    ].join("\n"),
    embeds: [],
    files: [],
    components: [memberRow, otherRow] as unknown as ActionRowBuilder<never>[],
  };
}

/**
 * Sentinel / encoded token on the persistent `/postboard` message.
 *
 * Not a real session key — interacting with these components spins up a fresh
 * per-user session and replies ephemerally so the public board never changes.
 *
 * Legacy posts use plain `board`. New posts encode optional role gates as
 * `b`, `b.w{roleId}`, `b.x{roleId}`, or `b.w{roleId}.x{roleId}` so access
 * rules survive bot restarts without a database row.
 */
export const BOARD_TOKEN = "board";

export interface BoardAccess {
  allowRoleIds: string[];
  blockRoleIds: string[];
}

/** True when a customId token belongs to the shared channel board (not a session). */
export function isBoardToken(token: string): boolean {
  return token === BOARD_TOKEN || token === "b" || token.startsWith("b.");
}

/** Encode optional allow/block role ids into a board customId token. */
export function encodeBoardToken(access: BoardAccess = { allowRoleIds: [], blockRoleIds: [] }): string {
  const parts = ["b"];
  for (const id of access.allowRoleIds) {
    if (/^\d{1,25}$/.test(id)) parts.push(`w${id}`);
  }
  for (const id of access.blockRoleIds) {
    if (/^\d{1,25}$/.test(id)) parts.push(`x${id}`);
  }
  const token = parts.length === 1 ? "b" : parts.join(".");
  // Discord custom_id max is 100; longest action prefix here is `emoji:pick_server:`.
  if (`emoji:pick_server:${token}`.length > 100) {
    throw new Error("Board access token too long for Discord customIds");
  }
  return token;
}

/** Parse allow/block role ids from a board token (including legacy `board`). */
export function parseBoardAccess(token: string): BoardAccess {
  if (token === BOARD_TOKEN || token === "b") {
    return { allowRoleIds: [], blockRoleIds: [] };
  }
  if (!token.startsWith("b.")) return { allowRoleIds: [], blockRoleIds: [] };
  const allowRoleIds: string[] = [];
  const blockRoleIds: string[] = [];
  for (const part of token.split(".").slice(1)) {
    if (part.startsWith("w") && /^\d{1,25}$/.test(part.slice(1))) {
      allowRoleIds.push(part.slice(1));
    } else if (part.startsWith("x") && /^\d{1,25}$/.test(part.slice(1))) {
      blockRoleIds.push(part.slice(1));
    }
  }
  return { allowRoleIds, blockRoleIds };
}

/**
 * Public channel board — same controls as `/emoji`, with how-to copy for a
 * live shared board. Pass {@link BoardAccess} to gate who may tap it.
 */
export function buildPublicBoard(access: BoardAccess = { allowRoleIds: [], blockRoleIds: [] }) {
  const token = encodeBoardToken(access);
  const chooser = buildTargetChooser(token);

  const accessLines: string[] = [];
  if (access.allowRoleIds.length > 0) {
    accessLines.push(`-# **Who can use it:** ${access.allowRoleIds.map(id => `<@&${id}>`).join(", ")} (plus admins)`);
  }
  if (access.blockRoleIds.length > 0) {
    accessLines.push(`-# **Blocked:** ${access.blockRoleIds.map(id => `<@&${id}>`).join(", ")}`);
  }

  return {
    ...chooser,
    content: [
      "## 🎨 Live emoji board",
      "Make an animated emoji right here — everyone can use this board at the same time.",
      "",
      "**How to use**",
      "1. Pick **who/what** to animate (member, your avatar, upload, or server icon).",
      "2. Browse styles on the private board that opens just for you.",
      "3. Apply a style, tweak settings if you want, then **Done**.",
      "4. **Save:** press-and-hold (mobile) or right-click (desktop) the image to download.",
      "",
      "-# Your session is private — other people won't see your picks. There's no Post-to-channel on this board.",
      "-# A short cooldown starts **after** your emoji is generated, so browsing stays free.",
      "-# ⭐ **Favorites** jumps to your starred styles on your avatar — tap **Target** there to switch subject.",
      ...accessLines,
    ].join("\n"),
  };
}

/** customId namespace. One router owns every id starting with this. */
export const CID = "emoji";

/** Discord's cap on options in one select menu. */
const MAX_SELECT_OPTIONS = 25;

/** Rows available for secondary options: five total, minus styles + format rows. */
const MAX_OPTION_ROWS = 3;

/**
 * Secondary panel options — animation is handled by the style browser, so it is
 * intentionally absent here.
 */
const PANEL_OPTIONS: readonly OptionKey[] = [
  "speed", "direction", "size", "quality", "color", "platform",
];

const LABELS: Record<OptionKey, string> = {
  animation: "Animation", speed: "Speed", direction: "Direction", size: "Size",
  color: "Colour", format: "Format", quality: "Quality", platform: "Platform",
};

export function cid(action: string, token: string): string {
  return `${CID}:${action}:${token}`;
}

/** Parse a namespaced customId. Returns null when it isn't ours. */
export function parseCid(customId: string): { action: string; token: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== CID) return null;
  return { action: parts[1]!, token: parts[2]! };
}

/** Current value of one manifest-driven setting on a session. */
function currentValue(session: EmojiSession, key: OptionKey): string | undefined {
  switch (key) {
    case "animation": return session.animation;
    case "speed": return session.speed;
    case "direction": return session.direction;
    case "size": return session.size;
    case "color": return session.color;
    case "quality": return session.quality;
    case "platform": return session.platform;
    case "format": return session.format;
  }
}

/**
 * A select row for one option, or null when it can't be rendered as one.
 *
 * Free-text and slider controls have no list to show, so they are left to the
 * slash-command option rather than faked as a dropdown.
 */
function optionRow(
  session: EmojiSession, token: string, key: OptionKey,
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const control = getManifest().manifest?.controls[key];
  if (!control || control.values.length === 0) return null;
  if (control.kind === "text" || control.kind === "range") return null;

  const selected = currentValue(session, key);
  const values = control.values.slice(0, MAX_SELECT_OPTIONS);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(cid(`set_${key}`, token))
    .setPlaceholder(LABELS[key])
    .addOptions(values.map(v =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${LABELS[key]} — ${(v.label ?? v.value)}`.slice(0, 100))
        .setValue(v.value.slice(0, 100))
        .setDefault(v.value === selected),
    ));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** Friendly label for the currently applied animation (scene or MakeEmoji style). */
function animationLabel(session: EmojiSession): string {
  const scene = sceneLabelOf(session.animation);
  if (scene) return scene;
  const values = getManifest().manifest?.controls.animation?.values ?? [];
  const hit = values.find(v => v.value === session.animation);
  return (hit?.label && hit.label.trim()) || session.animation;
}

function stylesRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  const label = animationLabel(session);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid("styles", token))
      .setLabel(`Browse styles — ${label}`.slice(0, 80))
      .setEmoji("🎨")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid("upload", token))
      .setLabel("Upload")
      .setEmoji("📎")
      .setStyle(ButtonStyle.Secondary),
    // Target switches share this row rather than taking one of their own: the
    // panel is already at Discord's five-row limit.
    new ButtonBuilder()
      .setCustomId(cid("target_server", token))
      .setLabel("Server icon")
      .setEmoji("🏠")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("target_me", token))
      .setLabel("My avatar")
      .setEmoji("🙂")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Modal with Discord's native file-upload control — swap the source mid-session. */
export function buildUploadModal(token: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("upload_modal", token))
    .setTitle("Upload an image")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Image to animate")
        .setDescription("Pick a PNG, JPG, GIF, or WebP from Discord")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("image")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
    );
}

function actionsRow(session: EmojiSession, token: string): ActionRowBuilder<ButtonBuilder> {
  const formatButtons = FORMATS.map(f =>
    new ButtonBuilder()
      .setCustomId(cid(`format_${f}`, token))
      .setLabel(f.toUpperCase())
      .setStyle(f === session.format ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const buttons = [...formatButtons];
  if (session.allowPost !== false) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid("post", token))
        .setLabel("Post")
        .setEmoji("📤")
        // Nothing to post until a generation has succeeded.
        .setDisabled(!session.lastResult)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(cid("done", token))
      .setLabel("Done")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

/**
 * Channel picker for sending the finished emoji somewhere.
 *
 * A separate view rather than another row: the control panel already uses all
 * five Discord allows.
 */
export function buildPostPicker(session: EmojiSession, token: string) {
  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(cid("post_pick", token))
    .setPlaceholder("Choose a channel to post it in")
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread);

  const back = new ButtonBuilder()
    .setCustomId(cid("post_back", token))
    .setLabel("Back")
    .setEmoji("◀️")
    .setStyle(ButtonStyle.Secondary);

  const size = session.lastResult ? `${(session.lastResult.bytes / 1024).toFixed(1)} KB` : "";
  return {
    content: `📤 **Post this emoji** — ${size}\n-# Or just save the image above; it's a normal attachment.`,
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker),
      new ActionRowBuilder<ButtonBuilder>().addComponents(back),
    ] as unknown as ActionRowBuilder<never>[],
  };
}

/**
 * The finish screen shown after **Done**.
 *
 * The old Done dumped the whole settings panel — every option line plus the gif —
 * and left it sitting there, which read as noise the moment the user was
 * finished. This is the clean hand-off instead: just the emoji and the two
 * things left to do with it — save it (tap the image) or post it — plus a way to
 * dismiss the dashboard or slip back into editing.
 */
export function buildFinishScreen(session: EmojiSession, token: string) {
  const result = session.lastResult;
  if (!result) {
    return {
      content: "✅ **Done!** Run `/emoji` any time to make another.",
      embeds: [] as never[],
      files: [] as AttachmentBuilder[],
      components: [] as ActionRowBuilder<never>[],
    };
  }

  const file = new AttachmentBuilder(result.buffer, { name: `emoji.${extensionFor(result.format)}` });
  const size = `${(result.bytes / 1024).toFixed(1)} KB`;
  const over = result.bytes > 262_144;

  const lines = [
    "## ✅ Your emoji is ready",
    `**${animationLabel(session)}** · \`${session.format.toUpperCase()}\` · ${size}`,
    session.allowPost !== false
      ? "-# **Save it:** tap the image, then Save. · **Share it:** Post it to a channel below."
      : "-# **Save it:** press-and-hold (mobile) or right-click (desktop) the image to download.",
  ];
  if (over) {
    lines.push("-# ⚠️ Over Discord's 256 KB custom-emoji limit — reopen editing and try a smaller size.");
  }

  const actions = new ActionRowBuilder<ButtonBuilder>();
  if (session.allowPost !== false) {
    actions.addComponents(
      new ButtonBuilder()
        .setCustomId(cid("post", token))
        .setLabel("Post to channel")
        .setEmoji("📤")
        .setStyle(ButtonStyle.Primary),
    );
  }
  actions.addComponents(
    new ButtonBuilder()
      .setCustomId(cid("keep_editing", token))
      .setLabel("Keep editing")
      .setEmoji("🎛️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid("dismiss", token))
      .setLabel("Dismiss")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: lines.join("\n"),
    embeds: [] as never[],
    files: [file],
    components: [actions] as unknown as ActionRowBuilder<never>[],
  };
}

/** The full control panel for a session. */
export function buildControls(session: EmojiSession, token: string): ActionRowBuilder<never>[] {
  const rows: ActionRowBuilder<never>[] = [];

  rows.push(stylesRow(session, token) as unknown as ActionRowBuilder<never>);

  // Scenes are composited clips: only Size (final long edge) and Speed (playback)
  // change their output. The MakeEmoji-only side-controls don't apply, so the
  // panel narrows to the two that do rather than showing dead dropdowns.
  const panelKeys: readonly OptionKey[] = isSceneAnimation(session.animation)
    ? ["speed", "size"]
    : PANEL_OPTIONS;
  for (const key of panelKeys) {
    if (rows.length >= 1 + MAX_OPTION_ROWS) break;
    const row = optionRow(session, token, key);
    if (row) rows.push(row as unknown as ActionRowBuilder<never>);
  }

  rows.push(actionsRow(session, token) as unknown as ActionRowBuilder<never>);
  return rows;
}

/** Rebuild the controls message from a cached generation (no provider call). */
export function buildCachedControlsReply(session: EmojiSession, token: string) {
  const result = session.lastResult;
  if (!result) return null;

  const file = new AttachmentBuilder(result.buffer, { name: resultFileName(result.buffer, result.format) });
  const sourceLabel = session.sourceLabel ?? "your image";
  const lines = [
    describe(session, result.bytes, result.providerId, result.cached),
    `-# from ${sourceLabel}`,
    resultHint(session),
  ];
  if (/avatar/i.test(sourceLabel)) {
    lines.push("-# Tip: tap **Upload** to animate your own image, or **Server icon** for this server's picture.");
  }
  // Scenes are full-size shareable clips — the MakeEmoji Colour hint doesn't
  // apply to them, so it's only shown for the small-emoji styles.
  if (!isSceneAnimation(session.animation)) {
    const anim = session.animation ?? "";
    const isNone = /^(gen_btn_)?none$/i.test(anim);
    if (!session.color || session.color === "Normal") {
      lines.push("-# Tip: set **Colour** (e.g. Colors / Rainbow / Stripes) to animate the image itself — works with style **none** or any style.");
    } else if (isNone) {
      lines.push("-# Colour-only mode (style none) — pick a style anytime to layer motion on top.");
    }
  }
  return {
    content: lines.join("\n"),
    embeds: [],
    files: [file],
    components: buildControls(session, token),
  };
}

/** One-line summary of the current settings, shown above the preview. */
export function describe(
  session: EmojiSession, bytes: number, providerId: string, cached: boolean,
): string {
  const parts = [`✨ **${animationLabel(session)}**`, `\`${session.format.toUpperCase()}\``];

  for (const key of ["speed", "direction", "size", "quality", "color", "platform"] as const) {
    const value = currentValue(session, key);
    if (value) parts.push(`\`${value}\``);
  }

  parts.push(`\`${(bytes / 1024).toFixed(1)} KB\``);
  // The offline engine is the normal generator now, so its output carries no
  // warning. `providerId` stays available in logs for diagnostics.
  void providerId;
  if (cached) parts.push("♻️");

  return parts.join(" · ");
}

/**
 * Modal for the Server target.
 *
 * Blank uses the current server's icon; a pasted server ID fetches that guild's
 * icon instead (the bot must be a member of it). This is what lets someone
 * animate any server's picture, not just the one they ran the command in.
 */
export function buildServerModal(token: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(cid("server_modal", token))
    .setTitle("Animate a server icon")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_id")
          .setLabel("Server ID (leave empty for this server)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMinLength(0)
          .setMaxLength(25),
      ),
    );
}

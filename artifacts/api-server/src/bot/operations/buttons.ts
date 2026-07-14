// Operations Center — component builders (buttons, select menus).

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { ALL_OP_KEYS, OP_DEFAULTS, type OpKey } from "./types.js";
import type { OpsActive, OpChannelButton } from "@workspace/db";
import type { ResolvedOpConfig } from "./embeds.js";

// ── Board action rows ─────────────────────────────────────────────────────────

/**
 * Build the button rows shown on the permanent board embed.
 * Buttons change based on the current operation status.
 */
export function buildBoardRows(
  resolved: ResolvedOpConfig,
  active: OpsActive | null,
  userIsResponder: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  const opKey = resolved.key;
  const status = active?.status ?? "inactive";

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (status === "inactive" || status === "completed") {
    // ── Inactive / just completed ─────────────────────────────────────────
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ops:btn:request:${opKey}`)
        .setLabel("Request Support")
        .setEmoji("📡")
        .setStyle(ButtonStyle.Primary),
    );

    if (status === "completed") {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ops:btn:history:${opKey}`)
          .setLabel("Last Operation")
          .setEmoji("📋")
          .setStyle(ButtonStyle.Secondary),
      );
    }

    rows.push(row);

  } else if (status === "active" && active) {
    // ── Active ────────────────────────────────────────────────────────────
    // Row 1 — join/leave + roblox
    const row1 = new ActionRowBuilder<ButtonBuilder>();

    if (userIsResponder) {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(`ops:btn:leave:${opKey}`)
          .setLabel("Leave")
          .setEmoji("🚪")
          .setStyle(ButtonStyle.Danger),
      );
    } else {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(`ops:btn:join:${opKey}`)
          .setLabel("Join")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
      );
    }

    // Deploy & Busy as status indicators (disabled links look like labels)
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`ops:btn:deploy:${opKey}`)
        .setLabel("Deploy")
        .setEmoji("🚀")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ops:btn:busy:${opKey}`)
        .setLabel("Busy")
        .setEmoji("⏳")
        .setStyle(ButtonStyle.Secondary),
    );

    if (active.robloxLink) {
      row1.addComponents(
        new ButtonBuilder()
          .setURL(active.robloxLink)
          .setLabel("Join Raid")
          .setEmoji("🎮")
          .setStyle(ButtonStyle.Link),
      );
    }

    rows.push(row1);

    // Row 2 — admin controls (complete / cancel / queue view)
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ops:btn:complete:${opKey}`)
        .setLabel("Complete")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ops:btn:cancel:${opKey}`)
        .setLabel("Cancel")
        .setEmoji("✖️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ops:btn:queue:${opKey}`)
        .setLabel("View Queue")
        .setEmoji("📋")
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(row2);
  }

  // ── Custom channel buttons (always shown if configured) ───────────────────
  const channelBtns = buildChannelButtonRow(resolved, status === "active");
  if (channelBtns) rows.push(channelBtns);

  return rows;
}

function buildChannelButtonRow(
  resolved: ResolvedOpConfig,
  isActive: boolean,
): ActionRowBuilder<ButtonBuilder> | null {
  // Would need the full OpsTypeConfig here — pass through resolved instead
  // Channel buttons are stored on the DB cfg, not in ResolvedOpConfig yet.
  // Placeholder: callers that have the cfg should call buildChannelButtonRowFromConfig.
  return null;
}

export function buildChannelButtonRowFromConfig(
  buttons: OpChannelButton[],
  isActive: boolean,
): ActionRowBuilder<ButtonBuilder> | null {
  const filtered = buttons.filter(b => !b.activeOnly || isActive).slice(0, 5);
  if (filtered.length === 0) return null;

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const b of filtered) {
    const btn = new ButtonBuilder()
      .setLabel(b.label)
      .setStyle(
        b.action === "url"
          ? ButtonStyle.Link
          : buttonStyleFromName(b.style),
      );

    if (b.action === "url" && b.url) {
      btn.setURL(b.url);
    } else {
      // Non-link buttons need a customId; use a no-op disabled pattern
      btn.setCustomId(`ops:btn:noop:${b.label.slice(0, 50)}`).setDisabled(b.action === "none");
    }
    if (b.emoji) {
      try { btn.setEmoji(b.emoji); } catch { /* skip invalid emoji */ }
    }
    row.addComponents(btn);
  }
  return row;
}

function buttonStyleFromName(s: string): ButtonStyle {
  switch (s) {
    case "primary": return ButtonStyle.Primary;
    case "success": return ButtonStyle.Success;
    case "danger": return ButtonStyle.Danger;
    default: return ButtonStyle.Secondary;
  }
}

// ── /support type-select row ──────────────────────────────────────────────────

export function buildSupportTypeSelect(enabledKeys: OpKey[]): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = enabledKeys.map(key => {
    const def = OP_DEFAULTS[key];
    return new StringSelectMenuOptionBuilder()
      .setValue(key)
      .setLabel(def.label)
      .setEmoji(def.emoji)
      .setDescription(def.description.slice(0, 100));
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ops:select:type")
      .setPlaceholder("Select the type of support you need…")
      .addOptions(options),
  );
}

// ── Admin configure type-select ───────────────────────────────────────────────

export function buildAdminTypeSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = ALL_OP_KEYS.map(key => {
    const def = OP_DEFAULTS[key];
    return new StringSelectMenuOptionBuilder()
      .setValue(key)
      .setLabel(def.label)
      .setEmoji(def.emoji);
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ops:admin_select:cfg")
      .setPlaceholder("Select an operation type to configure…")
      .addOptions(options),
  );
}

// ── Admin type-config action buttons ─────────────────────────────────────────

export function buildAdminTypeConfigRows(opKey: OpKey, enabled: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ops:admin_btn:setname:${opKey}`).setLabel("Rename").setEmoji("✏️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setdesc:${opKey}`).setLabel("Description").setEmoji("📝").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setcolor:${opKey}`).setLabel("Color").setEmoji("🎨").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setfooter:${opKey}`).setLabel("Footer").setEmoji("📄").setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ops:admin_btn:toggle:${opKey}`)
      .setLabel(enabled ? "Disable" : "Enable")
      .setEmoji(enabled ? "⚫" : "🟢")
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ops:admin_btn:setrequired:${opKey}`).setLabel("Required Responders").setEmoji("👥").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:settimeout:${opKey}`).setLabel("Timeout").setEmoji("⏱️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setmaxqueue:${opKey}`).setLabel("Max Queue").setEmoji("📋").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setthumb:${opKey}`).setLabel("Thumbnail").setEmoji("🖼️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ops:admin_btn:setbanner:${opKey}`).setLabel("Banner").setEmoji("🏳️").setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ops:admin_btn:cfg_back").setLabel("← Back to List").setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

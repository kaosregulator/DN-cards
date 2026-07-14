// Operations Center — embed builders for boards and admin panels.

import { EmbedBuilder } from "discord.js";
import type { OpsActive, OpsTypeConfig, OpsGuildConfig, OpsResponder, OpsQueue } from "@workspace/db";
import {
  OP_DEFAULTS, ALL_OP_KEYS, buildProgressBar, formatElapsed, hexToColor,
  type OpKey,
} from "./types.js";

// ── Resolved display config ───────────────────────────────────────────────────

export interface ResolvedOpConfig {
  key: OpKey;
  label: string;
  emoji: string;
  color: number;
  description: string;
  thumbnailUrl: string | null;
  bannerUrl: string | null;
  footerText: string | null;
  requiredResponders: number;
  maxQueueSize: number;
  timeoutMinutes: number;
  enabled: boolean;
}

export function resolveOpConfig(opKey: OpKey, cfg: OpsTypeConfig | null): ResolvedOpConfig {
  const def = OP_DEFAULTS[opKey];
  return {
    key: opKey,
    label: cfg?.displayName ?? def.label,
    emoji: def.emoji,
    color: hexToColor(cfg?.color, def.color),
    description: cfg?.description ?? def.description,
    thumbnailUrl: cfg?.thumbnailUrl ?? null,
    bannerUrl: cfg?.bannerUrl ?? null,
    footerText: cfg?.footerText ?? null,
    requiredResponders: cfg?.requiredResponders ?? 1,
    maxQueueSize: cfg?.maxQueueSize ?? 5,
    timeoutMinutes: cfg?.timeoutMinutes ?? 60,
    enabled: cfg?.enabled ?? true,
  };
}

// ── Board embed ───────────────────────────────────────────────────────────────

export function buildBoardEmbed(
  resolved: ResolvedOpConfig,
  active: OpsActive | null,
  responders: OpsResponder[],
  queueCount: number,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(resolved.color);

  const status = active?.status ?? "inactive";
  const isActive = status === "active";

  // Title
  embed.setTitle(`${resolved.emoji}  ${resolved.label}`);

  // Description
  const descParts: string[] = [];
  if (resolved.description) descParts.push(`*${resolved.description}*`);
  embed.setDescription(descParts.length ? descParts.join("\n") : null);

  // Status indicator
  const statusEmoji = isActive ? "🟢" : status === "completed" ? "✅" : "⚫";
  const statusLabel = isActive ? "**ACTIVE**" : status === "completed" ? "Completed" : "Inactive";
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Status", value: `${statusEmoji} ${statusLabel}`, inline: true },
  ];

  if (isActive && active) {
    // Commander
    if (active.commanderId) {
      fields.push({ name: "Commander", value: `<@${active.commanderId}>`, inline: true });
    }

    // Objective
    if (active.objective) {
      fields.push({ name: "Objective", value: active.objective, inline: false });
    }

    // Roblox link
    if (active.robloxLink) {
      fields.push({ name: "🎮 Roblox Link", value: active.robloxLink, inline: false });
    }

    // Responder progress
    const needed = active.respondersNeeded;
    const ready = responders.length;
    const bar = buildProgressBar(ready, needed);
    fields.push({
      name: "Responders",
      value: `\`${bar}\` ${ready}/${needed} (${needed === 0 ? 100 : Math.round((ready / needed) * 100)}%)`,
      inline: false,
    });

    // Responder list
    if (responders.length > 0) {
      const list = responders.slice(0, 15).map(r => `<@${r.userId}>`).join(" ");
      const overflow = responders.length > 15 ? ` +${responders.length - 15} more` : "";
      fields.push({ name: "✅ Ready", value: list + overflow, inline: false });
    }

    // Elapsed time
    fields.push({ name: "⏱️ Elapsed", value: formatElapsed(active.startedAt), inline: true });

    // Queue
    if (queueCount > 0) {
      fields.push({ name: "📋 Queue", value: `${queueCount} waiting`, inline: true });
    }

    // Admin notes
    if (active.notes) {
      fields.push({ name: "📝 Notes", value: active.notes, inline: false });
    }
  } else if (status === "inactive") {
    fields.push({
      name: "\u200b",
      value: "Use **Request Support** to start an operation.",
      inline: false,
    });
    if (queueCount > 0) {
      fields.push({ name: "📋 Queue", value: `${queueCount} waiting`, inline: true });
    }
  }

  embed.addFields(fields);

  // Images
  if (resolved.thumbnailUrl) embed.setThumbnail(resolved.thumbnailUrl);
  if (resolved.bannerUrl) embed.setImage(resolved.bannerUrl);

  // Footer
  const footerText = resolved.footerText ?? "Operations Center";
  embed.setFooter({ text: `${footerText} • Updated` }).setTimestamp();

  return embed;
}

// ── Setup / confirmation embeds ───────────────────────────────────────────────

export function buildSetupSuccessEmbed(channelId: string, count: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x4CAF50)
    .setTitle("✅ Operations Center Ready")
    .setDescription(
      `Boards have been posted in <#${channelId}>.\n` +
      `**${count}** operation type${count !== 1 ? "s" : ""} are now live.\n\n` +
      `Use \`/ops_admin configure\` to customise each operation type.`,
    )
    .setTimestamp();
}

export function buildSetupAlreadyEmbed(channelId: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF9800)
    .setTitle("⚠️ Already Configured")
    .setDescription(
      `Operations Center is already set up in <#${channelId}>.\n` +
      `Use \`/ops_admin configure\` to change settings, or \`/ops_admin rebuild\` to recreate boards.`,
    );
}

// ── Admin configure panel ─────────────────────────────────────────────────────

export function buildAdminConfigListEmbed(guildCfg: OpsGuildConfig | null, typeConfigs: OpsTypeConfig[]): EmbedBuilder {
  const cfgMap = new Map(typeConfigs.map(c => [c.opKey, c]));

  const lines = ALL_OP_KEYS.map(key => {
    const def = OP_DEFAULTS[key];
    const cfg = cfgMap.get(key);
    const label = cfg?.displayName ?? def.label;
    const enabled = cfg?.enabled ?? true;
    return `${enabled ? "🟢" : "⚫"} **${def.emoji} ${label}** \`${key}\``;
  });

  const channelLine = guildCfg?.opsChannelId
    ? `📡 Channel: <#${guildCfg.opsChannelId}>`
    : "📡 Channel: *not configured*";
  const roleLine = guildCfg?.staffRoleId
    ? `👥 Staff Role: <@&${guildCfg.staffRoleId}>`
    : "👥 Staff Role: *not set*";

  return new EmbedBuilder()
    .setColor(0x2196F3)
    .setTitle("⚙️ Operations Center — Configure")
    .setDescription(
      `${channelLine}\n${roleLine}\n\n**Operation Types**\nSelect one below to configure it.\n\n` +
      lines.join("\n"),
    )
    .setFooter({ text: "Changes apply to the live board instantly." });
}

export function buildAdminTypeConfigEmbed(resolved: ResolvedOpConfig, cfg: OpsTypeConfig | null): EmbedBuilder {
  const def = OP_DEFAULTS[resolved.key];

  const fields = [
    { name: "Display Name", value: resolved.label, inline: true },
    { name: "Status", value: resolved.enabled ? "🟢 Enabled" : "⚫ Disabled", inline: true },
    { name: "Color", value: cfg?.color ?? def.colorHex, inline: true },
    { name: "Required Responders", value: String(resolved.requiredResponders), inline: true },
    { name: "Timeout", value: `${resolved.timeoutMinutes}m`, inline: true },
    { name: "Max Queue", value: String(resolved.maxQueueSize), inline: true },
    { name: "Description", value: resolved.description, inline: false },
    { name: "Footer Text", value: resolved.footerText ?? "*not set*", inline: false },
    { name: "Thumbnail URL", value: resolved.thumbnailUrl ?? "*not set*", inline: false },
    { name: "Banner URL", value: resolved.bannerUrl ?? "*not set*", inline: false },
  ];

  return new EmbedBuilder()
    .setColor(resolved.color)
    .setTitle(`${resolved.emoji} Configure — ${resolved.label}`)
    .setDescription(`Backend key: \`${resolved.key}\` *(never changes)*`)
    .addFields(fields)
    .setFooter({ text: "Use the buttons below to edit each field." });
}

// ── Stats embed ───────────────────────────────────────────────────────────────

export function buildStatsEmbed(
  stats: { opKey: OpKey; totalStarted: number; totalCompleted: number; avgResponseSeconds: number | null }[],
): EmbedBuilder {
  if (stats.length === 0) {
    return new EmbedBuilder()
      .setColor(0x607D8B)
      .setTitle("📊 Operations Center — Statistics")
      .setDescription("No operations have been recorded yet.");
  }

  const lines = stats.map(s => {
    const def = OP_DEFAULTS[s.opKey];
    const rate = s.totalStarted > 0
      ? `${Math.round((s.totalCompleted / s.totalStarted) * 100)}%`
      : "—";
    const avg = s.avgResponseSeconds != null
      ? formatElapsed(new Date(Date.now() - s.avgResponseSeconds * 1000))
      : "—";
    return `${def.emoji} **${def.label}** — ${s.totalStarted} started • ${s.totalCompleted} done • ${rate} rate • avg ${avg}`;
  });

  return new EmbedBuilder()
    .setColor(0x2196F3)
    .setTitle("📊 Operations Center — Statistics")
    .setDescription(lines.join("\n"))
    .setTimestamp();
}

// ── Support wizard (ephemeral) ────────────────────────────────────────────────

export function buildSupportWizardEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x2196F3)
    .setTitle("📡 Request Operations Support")
    .setDescription(
      "Select the type of support you need below.\n" +
      "You'll be asked for a brief objective and how many responders are needed.",
    )
    .setFooter({ text: "Only visible to you." });
}

// ── Queue info (ephemeral) ────────────────────────────────────────────────────

export function buildQueueEmbed(queue: OpsQueue[], opLabel: string): EmbedBuilder {
  if (queue.length === 0) {
    return new EmbedBuilder()
      .setColor(0x4CAF50)
      .setTitle(`📋 ${opLabel} — Queue`)
      .setDescription("Queue is empty.");
  }

  const lines = queue.map((q, i) => {
    const obj = q.objective ? ` — ${q.objective}` : "";
    return `**${i + 1}.** <@${q.requesterId}>${obj}`;
  });

  return new EmbedBuilder()
    .setColor(0xFF9800)
    .setTitle(`📋 ${opLabel} — Queue (${queue.length})`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Next request promotes automatically when the current op completes." });
}

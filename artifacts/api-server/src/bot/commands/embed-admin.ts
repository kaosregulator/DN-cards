// /embed — admin command that owns all writes to embed_overrides.
// Replaces the old /admin/embeds dashboard page.
//   /embed show key                  — current override + defaults reminder
//   /embed set key field value       — set one field (color/text/bool/mode)
//   /embed reset key [field]         — reset one field, or the whole embed
//
// Discord = source of truth. The website never reads or writes this table.
import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { EMBED_KEYS, type EmbedKey, type EmbedOverrideConfig } from "@workspace/db";
import {
  getRawEmbedOverride, upsertEmbedOverride, deleteEmbedOverride,
} from "../embed-overrides.js";

const EMBED_KEY_LIST: readonly EmbedKey[] = EMBED_KEYS;

// All known fields on an EmbedOverrideConfig + the per-rarity color slots.
// Keep this list ≤ 25 for Discord choice limits.
const EMBED_FIELDS = [
  "enabled", "title", "footer", "descriptionPrefix",
  "color", "customImageUrl", "imageMode", "showWorth", "showDropChance",
  "rarityColor.common", "rarityColor.uncommon", "rarityColor.rare",
  "rarityColor.epic", "rarityColor.legendary", "rarityColor.mythic",
] as const;
type EmbedField = typeof EMBED_FIELDS[number];

const IMAGE_MODES = ["default", "large", "thumbnail", "none"] as const;

function parseHexColor(input: string): number | null {
  const s = input.trim().replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s) && !/^[0-9a-fA-F]{3}$/.test(s)) return null;
  const full = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : null;
}

function hex(n: number): string {
  return "#" + n.toString(16).padStart(6, "0");
}

function parseBool(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (["true", "yes", "y", "on", "1"].includes(v)) return true;
  if (["false", "no", "n", "off", "0"].includes(v)) return false;
  return null;
}

function isEmbedKey(s: string): s is EmbedKey {
  return (EMBED_KEY_LIST as readonly string[]).includes(s);
}

function fmtVal(field: EmbedField, cfg: EmbedOverrideConfig | null): string {
  if (!cfg) return "*(default)*";
  if (field === "enabled") return cfg.enabled === false ? "❌ disabled" : "✅ enabled (default)";
  if (field === "title") return cfg.title ? "`" + cfg.title.slice(0, 200) + "`" : "*(default)*";
  if (field === "footer") return cfg.footer ? "`" + cfg.footer.slice(0, 200) + "`" : "*(default)*";
  if (field === "descriptionPrefix") return cfg.descriptionPrefix ? "`" + cfg.descriptionPrefix.slice(0, 200) + "`" : "*(default)*";
  if (field === "color") return cfg.color === undefined ? "*(default)*" : hex(cfg.color);
  if (field === "customImageUrl") return cfg.customImageUrl ? cfg.customImageUrl.slice(0, 200) : "*(default)*";
  if (field === "imageMode") return cfg.imageMode ?? "default";
  if (field === "showWorth") return cfg.showWorth === false ? "❌ hidden" : "✅ shown (default)";
  if (field === "showDropChance") return cfg.showDropChance === false ? "❌ hidden" : "✅ shown (default)";
  if (field.startsWith("rarityColor.")) {
    const r = field.slice("rarityColor.".length) as keyof NonNullable<EmbedOverrideConfig["rarityColors"]>;
    const v = cfg.rarityColors?.[r];
    return v === undefined ? "*(default)*" : hex(v);
  }
  return "*(default)*";
}

function applyPatch(
  cfg: EmbedOverrideConfig,
  field: EmbedField,
  rawValue: string,
): { ok: true; cfg: EmbedOverrideConfig; preview: string } | { ok: false; error: string } {
  const trimmed = rawValue.trim();

  if (field === "enabled" || field === "showWorth" || field === "showDropChance") {
    const b = parseBool(trimmed);
    if (b === null) return { ok: false, error: "Value must be `true` or `false` (also accepted: yes/no, on/off, 1/0)." };
    cfg[field] = b;
    return { ok: true, cfg, preview: b ? "true" : "false" };
  }

  if (field === "title" || field === "footer" || field === "descriptionPrefix") {
    if (trimmed.length > 1000) return { ok: false, error: "Text fields must be ≤ 1000 chars." };
    if (trimmed === "") delete cfg[field];
    else cfg[field] = trimmed;
    return { ok: true, cfg, preview: trimmed === "" ? "*(cleared)*" : "`" + trimmed.slice(0, 100) + "`" };
  }

  if (field === "customImageUrl") {
    if (trimmed === "") { delete cfg.customImageUrl; return { ok: true, cfg, preview: "*(cleared)*" }; }
    if (!/^https?:\/\//i.test(trimmed)) return { ok: false, error: "Image URL must start with `http://` or `https://` (or pass empty to clear)." };
    if (trimmed.length > 500) return { ok: false, error: "URL too long (max 500 chars)." };
    cfg.customImageUrl = trimmed;
    return { ok: true, cfg, preview: trimmed };
  }

  if (field === "imageMode") {
    if (!(IMAGE_MODES as readonly string[]).includes(trimmed)) {
      return { ok: false, error: "imageMode must be one of: " + IMAGE_MODES.join(", ") };
    }
    cfg.imageMode = trimmed as EmbedOverrideConfig["imageMode"];
    return { ok: true, cfg, preview: trimmed };
  }

  if (field === "color") {
    if (trimmed === "") { delete cfg.color; return { ok: true, cfg, preview: "*(cleared)*" }; }
    const n = parseHexColor(trimmed);
    if (n === null) return { ok: false, error: "Color must be a hex code like `#ff2d92` (or empty to clear)." };
    cfg.color = n;
    return { ok: true, cfg, preview: hex(n) };
  }

  if (field.startsWith("rarityColor.")) {
    const r = field.slice("rarityColor.".length) as keyof NonNullable<EmbedOverrideConfig["rarityColors"]>;
    const colors = { ...(cfg.rarityColors ?? {}) };
    if (trimmed === "") {
      delete colors[r];
      if (Object.keys(colors).length === 0) delete cfg.rarityColors;
      else cfg.rarityColors = colors;
      return { ok: true, cfg, preview: "*(cleared)*" };
    }
    const n = parseHexColor(trimmed);
    if (n === null) return { ok: false, error: "Color must be a hex code like `#ff2d92` (or empty to clear)." };
    colors[r] = n;
    cfg.rarityColors = colors;
    return { ok: true, cfg, preview: hex(n) };
  }

  return { ok: false, error: "Unknown field." };
}

function buildShowEmbed(key: EmbedKey, cfg: EmbedOverrideConfig | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🎨 Embed override: ${key}`)
    .setColor(cfg?.color ?? 0x5865f2)
    .setDescription(cfg
      ? "Current override for this embed. Unset fields fall back to the bot defaults."
      : "_No override set — using bot defaults. Use_ `/embed set` _to customize._");
  for (const f of EMBED_FIELDS) {
    embed.addFields({ name: f, value: fmtVal(f, cfg), inline: true });
  }
  embed.setFooter({ text: "Tokens supported in title/footer/descriptionPrefix: {user} {card} {rarity} {worth} {chance} {streak} {tier} {amount} {balance} {guild} {channel}" });
  return embed;
}

export async function handleEmbedAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(true);

  const keyRaw = interaction.options.getString("key", true);
  if (!isEmbedKey(keyRaw)) {
    await interaction.editReply("❌ Unknown embed key. Valid keys: " + EMBED_KEY_LIST.join(", "));
    return;
  }
  const key: EmbedKey = keyRaw;

  if (sub === "show") {
    const cfg = await getRawEmbedOverride(guildId, key);
    await interaction.editReply({ embeds: [buildShowEmbed(key, cfg)] });
    return;
  }

  if (sub === "set") {
    const field = interaction.options.getString("field", true) as EmbedField;
    if (!(EMBED_FIELDS as readonly string[]).includes(field)) {
      await interaction.editReply("❌ Unknown field. Pick from the autocomplete list.");
      return;
    }
    const value = interaction.options.getString("value", true);
    const existing = (await getRawEmbedOverride(guildId, key)) ?? {};
    const patched = applyPatch({ ...existing }, field, value);
    if (!patched.ok) { await interaction.editReply("❌ " + patched.error); return; }
    await upsertEmbedOverride(guildId, key, patched.cfg, userId);
    await interaction.editReply(`✅ \`${key}\`.\`${field}\` → ${patched.preview}\n\nUse \`/embed show key:${key}\` to see the full config.`);
    return;
  }

  if (sub === "reset") {
    const field = interaction.options.getString("field") as EmbedField | null;
    if (!field) {
      const removed = await deleteEmbedOverride(guildId, key);
      await interaction.editReply(
        removed
          ? `🔄 Cleared the entire override for \`${key}\`. This embed now uses bot defaults.`
          : `ℹ️ \`${key}\` had no override set.`,
      );
      return;
    }
    if (!(EMBED_FIELDS as readonly string[]).includes(field)) {
      await interaction.editReply("❌ Unknown field.");
      return;
    }
    const existing = await getRawEmbedOverride(guildId, key);
    if (!existing) { await interaction.editReply(`ℹ️ \`${key}\` has no override set; nothing to clear.`); return; }
    const cfg: EmbedOverrideConfig = { ...existing };
    if (field === "color" || field === "title" || field === "footer" || field === "descriptionPrefix" || field === "customImageUrl") {
      delete cfg[field];
    } else if (field === "imageMode") {
      delete cfg.imageMode;
    } else if (field === "enabled" || field === "showWorth" || field === "showDropChance") {
      delete cfg[field];
    } else if (field.startsWith("rarityColor.")) {
      const r = field.slice("rarityColor.".length) as keyof NonNullable<EmbedOverrideConfig["rarityColors"]>;
      if (cfg.rarityColors) {
        const colors = { ...cfg.rarityColors };
        delete colors[r];
        if (Object.keys(colors).length === 0) delete cfg.rarityColors;
        else cfg.rarityColors = colors;
      }
    }
    if (Object.keys(cfg).length === 0) {
      await deleteEmbedOverride(guildId, key);
      await interaction.editReply(`🔄 Cleared \`${key}\`.\`${field}\`. The override row was empty after clearing, so it was removed entirely.`);
      return;
    }
    await upsertEmbedOverride(guildId, key, cfg, userId);
    await interaction.editReply(`🔄 Cleared \`${key}\`.\`${field}\`. Remaining fields stay applied.`);
    return;
  }

  await interaction.editReply("❌ Unknown embed subcommand.");
}

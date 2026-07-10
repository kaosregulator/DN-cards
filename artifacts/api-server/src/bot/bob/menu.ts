// The /bob interactive menu. One ephemeral message with a button grid that
// edits itself between sections (no channel spam). Sections: Games, Roast,
// Tasks, Rewards, Talk, Quests, Stats.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  type ButtonInteraction, type StringSelectMenuInteraction, type ChatInputCommandInteraction,
} from "discord.js";
import { getBobSettings, getBobProfile, activeCurse } from "./db.js";
import { rollForm, pick, speak, GREETINGS, FORMS, formTitle, type BobForm } from "./persona.js";
import { bobEmbed, EPHEMERAL, coins } from "./ui.js";
import { GAME_KEYS, GAME_META } from "./games.js";
import { getDailyTasks, getQuests } from "./progress.js";
import { buildStatsEmbed } from "./stats.js";
import { talkIntro, talkComponents } from "./talk.js";
import { roastPickerRow } from "./roast.js";

function homeButtons(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("bob:menu:games").setLabel("Games").setEmoji("🎲").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bob:menu:roast").setLabel("Roast").setEmoji("😂").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bob:menu:tasks").setLabel("Tasks").setEmoji("🎯").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bob:menu:quests").setLabel("Quests").setEmoji("📜").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("bob:menu:rewards").setLabel("Rewards").setEmoji("🎁").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bob:menu:talk").setLabel("Talk").setEmoji("💬").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bob:menu:stats").setLabel("Stats").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bob:roulette:again").setLabel("Roulette").setEmoji("🔫").setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function homeView(guildId: string, userId: string, form: BobForm) {
  const p = await getBobProfile(guildId, userId);
  const curse = activeCurse(p);
  const embed = bobEmbed(form, "Menu",
    `${speak(form, pick(GREETINGS[form]))}\n\n${coins(p.coins)} · Level **${p.level}**${p.currentTitle ? ` · ${p.currentTitle}` : ""}` +
    (curse ? `\n🌀 ${curse}` : "") +
    `\n\nPick your poison:`)
    .setFooter({ text: `${formTitle(form)} · ${FORMS[form].blurb}` });
  return { embeds: [embed], components: homeButtons() };
}

// Open from slash /bob (ephemeral).
export async function openBobMenu(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) { await interaction.reply({ content: "Bob lives in servers.", ...EPHEMERAL }); return; }
  const settings = await getBobSettings(interaction.guildId);
  if (!settings.enabled) { await interaction.reply({ content: "😴 Bob is switched off here. An admin can wake him with `/bob_admin`.", ...EPHEMERAL }); return; }
  const form = rollForm(settings);
  await interaction.reply({ ...(await homeView(interaction.guildId, interaction.user.id, form)), ...EPHEMERAL });
}

// Router for bob:menu:<section> buttons.
export async function handleBobMenu(interaction: ButtonInteraction, section: string): Promise<void> {
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const settings = await getBobSettings(guildId);
  const form = rollForm(settings);

  switch (section) {
    case "home":
      await interaction.update(await homeView(guildId, userId, form)).catch(() => {});
      return;
    case "games": {
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      let row = new ActionRowBuilder<ButtonBuilder>();
      GAME_KEYS.forEach((k, i) => {
        row.addComponents(new ButtonBuilder().setCustomId(`bob:game:${k}:open`).setLabel(GAME_META[k].label).setEmoji(GAME_META[k].emoji).setStyle(ButtonStyle.Primary));
        if ((i + 1) % 3 === 0) { rows.push(row); row = new ActionRowBuilder<ButtonBuilder>(); }
      });
      if (row.components.length) rows.push(row);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("bob:roulette:again").setLabel("Roulette").setEmoji("🔫").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("bob:menu:home").setLabel("Back").setEmoji("↩️").setStyle(ButtonStyle.Secondary)));
      await interaction.update({ embeds: [bobEmbed(form, "Games", "Pick a game. Win coins. Lose dignity. The Bob way.")], components: rows }).catch(() => {});
      return;
    }
    case "roast":
      await interaction.update({ embeds: [bobEmbed(form, "Roast", "Who's getting cooked today? Choose your victim.")], components: [roastPickerRow(), backRow()] }).catch(() => {});
      return;
    case "talk":
      await interaction.update({ embeds: [talkIntro(form, activeCurse(await getBobProfile(guildId, userId)))], components: [talkComponents()] }).catch(() => {});
      return;
    case "stats":
      await interaction.update({ embeds: [await buildStatsEmbed(guildId, userId, form, interaction.user.username)], components: [backRow()] }).catch(() => {});
      return;
    case "tasks": {
      const { items } = await getDailyTasks(guildId, userId);
      const body = items.map(o => `${o.done ? "✅" : o.emoji} ${o.label} — **${Math.min(o.progress, o.goal)}/${o.goal}** · 🪙 ${o.rewardCoins}`).join("\n");
      await interaction.update({ embeds: [bobEmbed(form, "Daily Tasks", body || "No tasks today. Suspicious.")], components: [backRow()] }).catch(() => {});
      return;
    }
    case "quests": {
      const items = await getQuests(guildId, userId);
      const body = items.map(o => `${o.done ? "✅" : o.emoji} ${o.label} — **${Math.min(o.progress, o.goal)}/${o.goal}** · 🪙 ${o.rewardCoins}${o.rewardTitle ? ` · 🏷️ ${o.rewardTitle}` : ""}`).join("\n");
      await interaction.update({ embeds: [bobEmbed(form, "Quests", body)], components: [backRow()] }).catch(() => {});
      return;
    }
    case "rewards": {
      const p = await getBobProfile(guildId, userId);
      const embed = bobEmbed(form, "Rewards & Titles",
        `${coins(p.coins)} · Level **${p.level}**\n\n**Your titles:** ${p.titles.length ? p.titles.join(", ") : "*none yet — win games and finish quests!*"}\n\nEquip one below.`);
      const comps: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
      if (p.titles.length) {
        comps.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId("bob:title:equip").setPlaceholder("🏷️ Equip a title…")
            .addOptions([{ label: "None", value: "__none__", default: !p.currentTitle }, ...p.titles.slice(0, 24).map(t => ({ label: t.slice(0, 100), value: t, default: t === p.currentTitle }))])));
      }
      comps.push(backRow());
      await interaction.update({ embeds: [embed], components: comps }).catch(() => {});
      return;
    }
    default:
      await interaction.update(await homeView(guildId, userId, form)).catch(() => {});
  }
}

function backRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("bob:menu:home").setLabel("Back to Menu").setEmoji("🏠").setStyle(ButtonStyle.Secondary));
}

// Equip a cosmetic title (bob:title:equip select).
export async function handleTitleEquip(interaction: StringSelectMenuInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const choice = interaction.values[0]!;
  const p = await getBobProfile(guildId, interaction.user.id);
  const next = choice === "__none__" ? null : (p.titles.includes(choice) ? choice : p.currentTitle);
  const { db, bobProfilesTable } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  await db.update(bobProfilesTable).set({ currentTitle: next })
    .where(and(eq(bobProfilesTable.guildId, guildId), eq(bobProfilesTable.userId, interaction.user.id)));
  const form = rollForm(await getBobSettings(guildId));
  await interaction.update({ content: next ? `🏷️ Equipped **${next}**.` : "🏷️ Title removed.", embeds: [bobEmbed(form, "Rewards & Titles", `Updated. Looking sharp${next ? "" : "... plain, but sharp"}.`)], components: [backRow()] }).catch(() => {});
}

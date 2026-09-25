// Russian roulette duel — multi-embed scene sequence with avatars + toy gun.
// Reuses battle canvas patterns (loadArt, particles) via render-russian-duel.

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  User,
} from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import { UNBELIEVABOAT_AUTHOR, UNBELIEVABOAT_COLOR } from "./branding.js";
import {
  CashError, earnCash, spendFunds, getCashBalance, fmtCash, formatSpendNote,
} from "./cash.js";
import { assertGameCooldown, markGameCooldown } from "./cooldowns.js";
import { getOrCreateUbSettings, writeUbAudit } from "../../lib/unbelievaboat/db.js";
import { replyThenPostAsUnbelievaBoat, openTableAsUnbelievaBoat } from "./webhook.js";
import { renderRussianScene, type RussianScene } from "./render-russian-duel.js";
import { RESPONSIBLE_PLAY } from "./live-slots.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

const challenges = new Map<string, {
  guildId: string; challengerId: string; targetId: string; bet: number; expires: number;
}>();

function brandEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(UNBELIEVABOAT_COLOR)
    .setAuthor(UNBELIEVABOAT_AUTHOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${RESPONSIBLE_PLAY} · Toy prop only — no real firearms.` });
}

async function attachGif(result: { buffer: Buffer } | null, name: string) {
  if (!result) return { files: [] as AttachmentBuilder[], imageName: null as string | null };
  return { files: [new AttachmentBuilder(result.buffer, { name })], imageName: name };
}

async function assertGamesOn(guildId: string) {
  const s = await getOrCreateUbSettings(guildId);
  if (!s.gamesEnabled) throw new CashError("UnbelievaBoat mini-games are disabled on this server.");
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function playDuelScenes(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  opts: {
    challenger: User;
    target: User;
    bet: number;
    fromCash: number;
    fromBank: number;
    /** Who loses (bang). Other survives. */
    loserId: string;
    survived: boolean; // for AI solo vs avatar — challenger survived?
  },
) {
  const challengerUrl = opts.challenger.displayAvatarURL({ size: 256, extension: "png" });
  const targetUrl = opts.target.displayAvatarURL({ size: 256, extension: "png" });
  const aimedAt: "challenger" | "target" =
    opts.loserId === opts.challenger.id ? "challenger" : "target";

  const scenes: { scene: RussianScene; caption: string; delayMs: number }[] = [
    { scene: "intro", caption: "**Face off** — toy duel on the felt.", delayMs: 1600 },
    { scene: "load", caption: "**Loading** the chambers…", delayMs: 1800 },
    { scene: "spin", caption: "**Spinning** the cylinder…", delayMs: 2200 },
    { scene: "raise", caption: `**Raising** toward <@${opts.loserId === opts.challenger.id && !opts.survived ? opts.challenger.id : aimedAt === "challenger" ? opts.challenger.id : opts.target.id}>…`, delayMs: 1600 },
  ];

  // Clarify raise target: for challenge, gun points at loser; for AI survive, point at target avatar as drama then click on challenger
  const raiseAimed = opts.survived ? (aimedAt === "challenger" ? "target" : "challenger") : aimedAt;

  for (let i = 0; i < scenes.length; i++) {
    const step = scenes[i]!;
    const aimed = step.scene === "raise" ? raiseAimed : undefined;
    const gif = await renderRussianScene({
      scene: step.scene,
      challengerUrl,
      targetUrl,
      challengerName: opts.challenger.username,
      targetName: opts.target.username,
      aimedAt: aimed,
    });
    const { files, imageName } = await attachGif(gif, `rr-${step.scene}.gif`);
    const embed = brandEmbed(`🔫 Duel — ${step.scene.toUpperCase()}`, [
      `${opts.challenger} vs ${opts.target}`,
      `Stake **${fmtCash(opts.bet)}** each side of the pot`,
      step.caption,
    ].join("\n"));
    if (imageName) embed.setImage(`attachment://${imageName}`);
    if (i === 0) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], files, components: [] });
      }
    } else {
      await interaction.editReply({ embeds: [embed], files, components: [] });
    }
    await sleep(Math.min(step.delayMs, 1200)); // keep total under Discord patience
  }

  const finale: RussianScene = opts.survived ? "click" : "bang";
  const finaleAimed = opts.survived ? raiseAimed : aimedAt;
  const gif = await renderRussianScene({
    scene: finale,
    challengerUrl,
    targetUrl,
    challengerName: opts.challenger.username,
    targetName: opts.target.username,
    aimedAt: finaleAimed,
  });
  const { files, imageName } = await attachGif(gif, `rr-${finale}.gif`);
  return { files, imageName, finale };
}

export async function handleRussian(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Server only.", ...EPHEMERAL });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await assertGamesOn(interaction.guildId);
    await assertGameCooldown(interaction.guildId, interaction.user.id);
    const target = interaction.options.getUser("target", true);
    const bet = interaction.options.getInteger("bet", true);
    const mode = interaction.options.getString("mode") ?? "challenge";
    if (target.bot || target.id === interaction.user.id) {
      await interaction.editReply("Pick another real member.");
      return;
    }

    if (mode === "challenge") {
      const key = `${interaction.guildId}:${interaction.user.id}:${target.id}`;
      challenges.set(key, {
        guildId: interaction.guildId,
        challengerId: interaction.user.id,
        targetId: target.id,
        bet,
        expires: Date.now() + 5 * 60_000,
      });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`unbgame:russian:accept:${interaction.user.id}:${bet}`).setLabel("Accept duel").setEmoji("🔫").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`unbgame:russian:decline:${interaction.user.id}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
      );
      const embed = brandEmbed("🔫 Toy Duel Challenge", [
        `${interaction.user} challenges ${target}`,
        `Pot stake **${fmtCash(bet)}** each (cash then bank)`,
        "",
        `${target} — **Accept duel** to play the scene.`,
      ].join("\n"));
      await openTableAsUnbelievaBoat(interaction, { embeds: [embed], components: [row] },
        "✅ Challenge posted as **UnbelievaBoat** — wait for accept on the floor.");
      return;
    }

    // AI / avatar duel — cinematic vs their avatar
    const spent = await spendFunds(interaction.guildId, interaction.user.id, bet, `Russian vs ${target.id}`);
    await markGameCooldown(interaction.guildId, interaction.user.id);
    const chamber = Math.floor(Math.random() * 6);
    const survived = Math.floor(Math.random() * 6) !== chamber;
    let bal = spent.balance;
    if (survived) bal = await earnCash(interaction.guildId, interaction.user.id, bet * 2, "Russian win");

    const { files, imageName, finale } = await playDuelScenes(interaction, {
      challenger: interaction.user,
      target,
      bet,
      fromCash: spent.fromCash,
      fromBank: spent.fromBank,
      loserId: survived ? target.id : interaction.user.id,
      survived,
    });

    const embed = brandEmbed(
      finale === "click" ? "🔫 Click — safe" : "🔫 Bang!",
      [
        `${interaction.user} vs ${target} (avatar duel)`,
        formatSpendNote(spent.fromCash, spent.fromBank, bal.symbol),
        survived ? `🟢 Survived — net win **${fmtCash(bet)}** ${bal.symbol}` : `🔴 Lost stake **${fmtCash(bet)}**`,
        `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}**`,
      ].join("\n"),
    );
    if (imageName) embed.setImage(`attachment://${imageName}`);
    await replyThenPostAsUnbelievaBoat(interaction, { embeds: [embed], files });
  } catch (err) {
    await interaction.editReply(err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`);
  }
}

export async function handleRussianComponent(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith("unbgame:russian:") || !interaction.guildId) return false;

  if (id.startsWith("unbgame:russian:decline:")) {
    const challengerId = id.slice("unbgame:russian:decline:".length);
    for (const [k, v] of challenges) {
      if (v.targetId === interaction.user.id && v.challengerId === challengerId) {
        challenges.delete(k);
        await interaction.reply({ content: "Challenge declined.", ...EPHEMERAL });
        return true;
      }
    }
    await interaction.reply({ content: "No open challenge.", ...EPHEMERAL });
    return true;
  }

  if (id.startsWith("unbgame:russian:accept:")) {
    const parts = id.split(":");
    const challengerId = parts[3]!;
    const bet = Number(parts[4] ?? 0);
    const mapKey = `${interaction.guildId}:${challengerId}:${interaction.user.id}`;
    const ch = challenges.get(mapKey);
    if (!ch || ch.expires < Date.now()) {
      challenges.delete(mapKey);
      await interaction.reply({ content: "Challenge expired.", ...EPHEMERAL });
      return true;
    }
    if (interaction.user.id !== ch.targetId) {
      await interaction.reply({ content: "Only the challenged member can accept.", ...EPHEMERAL });
      return true;
    }
    challenges.delete(mapKey);
    // Update the floor challenge message in place (UnbelievaBoat webhook author stays).
    await interaction.deferUpdate();
    try {
      await assertGamesOn(interaction.guildId);
      const challenger = await interaction.client.users.fetch(challengerId);
      await spendFunds(interaction.guildId, challengerId, bet, "Russian challenge stake");
      try {
        await spendFunds(interaction.guildId, interaction.user.id, bet, "Russian challenge stake");
      } catch (err) {
        // Target couldn't pay — refund challenger so we don't strand their stake.
        await earnCash(interaction.guildId, challengerId, bet, "Russian challenge refund").catch(() => null);
        throw err;
      }
      const survivorIsChallenger = Math.random() < 0.5;
      const winner = survivorIsChallenger ? challenger : interaction.user;
      const loser = survivorIsChallenger ? interaction.user : challenger;
      const pot = bet * 2;
      const bal = await earnCash(interaction.guildId, winner.id, pot, "Russian challenge pot");
      await writeUbAudit(interaction.guildId, challengerId, "russian_challenge", { bet, winner: winner.id }, interaction.user.id);

      const { files, imageName, finale } = await playDuelScenes(interaction, {
        challenger,
        target: interaction.user,
        bet,
        fromCash: 0,
        fromBank: 0,
        loserId: loser.id,
        survived: false, // finale bang on loser
      });
      void finale;

      const embed = brandEmbed("🔫 Live Duel — Result", [
        `${challenger} vs ${interaction.user} · pot **${fmtCash(pot)}**`,
        `🏆 ${winner} takes the pot.`,
        `Cash **${fmtCash(bal.cash)}** · bank **${fmtCash(bal.bank)}** ${bal.symbol}`,
      ].join("\n"));
      if (imageName) embed.setImage(`attachment://${imageName}`);
      await interaction.editReply({ embeds: [embed], files, components: [] });
    } catch (err) {
      await interaction.followUp({
        content: err instanceof CashError ? err.message : `Failed: ${err instanceof Error ? err.message : err}`,
        ...EPHEMERAL,
      }).catch(() => {});
      await interaction.editReply({
        content: "Duel failed — check balances if a stake was taken.",
        embeds: [],
        components: [],
        files: [],
      }).catch(() => {});
    }
    return true;
  }

  return false;
}

// Random Bob appearances. On a slow timer Bob may crash into an ADMIN-CONFIGURED
// channel ("BOB HAS ARRIVED.") with a quick community event: first-click, trivia,
// or a mystery box. Rare Blue/Upside forms twist the rewards. In-memory sessions
// with a short TTL — nothing persists. Events only fire in configured channels,
// so Bob never spams a server uninvited.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type ButtonInteraction, type Client, type Message, type TextChannel,
} from "discord.js";
import { randomBytes } from "crypto";
import { getBobSettings, grantReward, grantDexReward } from "./db.js";
import { rollForm, pick, speak, type BobForm } from "./persona.js";
import { bobEmbed, coins } from "./ui.js";
import { logger } from "../../lib/logger.js";
import { getBotClient } from "../client-holder.js";
import type { BobSettings } from "@workspace/db";

type EventKind = "firstclick" | "trivia" | "mystery";

interface EventSession {
  id: string;
  guildId: string;
  channelId: string;
  kind: EventKind;
  form: BobForm;
  answer?: number;       // trivia correct index
  reward: number;        // base coin reward
  dexReward?: boolean;   // rare: also pays DN Cards shards (if integration on)
  claimed: boolean;
  message?: Message;
  timer?: NodeJS.Timeout;
}

const active = new Map<string, EventSession>();
const channelBusy = new Set<string>(); // one live event per channel
function newId() { return randomBytes(4).toString("hex"); }

const TRIVIA = [
  { q: "What happens when you get three-of-a-kind in slots?", options: ["Nothing", "Jackpot", "Bob cries", "A frog"], a: 1 },
  { q: "What colour is EVIL Bob?", options: ["Red", "Green", "Blue", "Gold"], a: 2 },
  { q: "In roulette, which is the GOOD outcome?", options: ["BANG", "CLICK", "BONK", "SPLAT"], a: 1 },
  { q: "How rare is Upside-Down Bob?", options: ["Common", "50%", "1-3%", "Never"], a: 2 },
  { q: "What does Bob run on?", options: ["Coffee", "Chaos", "Batteries", "Spite"], a: 1 },
];

// ── Spawn ────────────────────────────────────────────────────────────────────
export async function spawnBobEvent(client: Client, guildId: string, channelId: string, settings: BobSettings): Promise<void> {
  if (channelBusy.has(channelId)) return;
  const channel = client.channels.cache.get(channelId) ?? await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const form = rollForm(settings);
  const kind: EventKind = pick(["firstclick", "trivia", "mystery"] as const);
  const dexReward = settings.dexIntegration && Math.random() < 0.15; // rare DN Cards payout
  const reward = form === "blue" ? 150 : form === "upside" ? 80 : 100;
  const s: EventSession = { id: newId(), guildId, channelId, kind, form, reward, dexReward, claimed: false };

  const arrival = form === "blue" ? "🔵 **BLUE BOB HAS TAKEN OVER.**" : form === "upside" ? "🙃 **ƨɒʜ ᗺOᗺ… ɘⱱiɿɿɒ**" : "🟡 **BOB HAS ARRIVED.**";
  let embed; let row;
  if (kind === "firstclick") {
    embed = bobEmbed(form, "Quick! First click wins!", `${arrival}\n\nFirst person to smash the button wins ${coins(reward)}${dexReward ? " + 💠 DN Shards" : ""}!`);
    row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`bob:event:click:${s.id}`).setLabel("CLICK ME").setEmoji("🎯").setStyle(ButtonStyle.Success));
  } else if (kind === "trivia") {
    const t = pick(TRIVIA); s.answer = t.a;
    embed = bobEmbed(form, "Trivia Time!", `${arrival}\n\n**${t.q}**\n\nFirst correct answer wins ${coins(reward)}${dexReward ? " + 💠 DN Shards" : ""}!`);
    row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      t.options.map((o, i) => new ButtonBuilder().setCustomId(`bob:event:trivia:${s.id}:${i}`).setLabel(o).setStyle(ButtonStyle.Primary)));
  } else {
    embed = bobEmbed(form, "Mystery Box!", `${arrival}\n\nA mystery box appeared. First to open it gets... something. Probably.`);
    row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`bob:event:mystery:${s.id}`).setLabel("Open the Box").setEmoji("🎁").setStyle(ButtonStyle.Success));
  }

  const msg = await (channel as TextChannel).send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!msg) return;
  s.message = msg;
  active.set(s.id, s);
  channelBusy.add(channelId);
  s.timer = setTimeout(() => expire(s), 60_000);
}

function expire(s: EventSession) {
  if (s.timer) clearTimeout(s.timer);
  active.delete(s.id);
  channelBusy.delete(s.channelId);
  if (!s.claimed && s.message) {
    s.message.edit({ embeds: [bobEmbed(s.form, "Event over", "Nobody claimed it in time. Bob leaves, disappointed but not surprised.")], components: [] }).catch(() => {});
  }
}

// ── Resolve clicks ───────────────────────────────────────────────────────────
export async function handleBobEvent(interaction: ButtonInteraction, parts: string[]): Promise<void> {
  // bob:event:<kind>:<id>[:data]
  const kind = parts[2];
  const s = active.get(parts[3] ?? "");
  if (!s) { await interaction.reply({ content: "⌛ That event already ended.", flags: 64 }).catch(() => {}); return; }
  if (s.claimed) { await interaction.reply({ content: "Too slow! Someone beat you to it.", flags: 64 }).catch(() => {}); return; }

  if (kind === "trivia") {
    const choice = Number(parts[4]);
    if (choice !== s.answer) { await interaction.reply({ content: "❌ Wrong! No takebacks.", flags: 64 }).catch(() => {}); return; }
  }

  // Winner!
  s.claimed = true;
  if (s.timer) clearTimeout(s.timer);
  active.delete(s.id);
  channelBusy.delete(s.channelId);

  const settings = await getBobSettings(s.guildId);
  let coinReward = s.reward;
  let extra = "";
  if (kind === "mystery") {
    // Mystery box: random reward, small chance of a big one or a funny dud.
    const r = Math.random();
    coinReward = r < 0.1 ? 500 : r < 0.4 ? 200 : r < 0.85 ? 100 : 10;
    extra = coinReward === 10 ? " (a single sad coin — the box was mostly air)" : coinReward >= 500 ? " 💎 **JACKPOT BOX!**" : "";
  }
  const reward = await grantReward(s.guildId, interaction.user.id, settings, {
    coins: coinReward, xp: 40, win: true, interaction: true,
  });
  const dexNotes = s.dexReward ? await grantDexReward(s.guildId, interaction.user.id, settings, { shards: 250 }) : [];
  const dexLine = dexNotes.length ? `\n🎉 Bonus: ${dexNotes.join(", ")}` : "";

  const line = speak(s.form, form_congrats(s.form));
  await interaction.update({
    embeds: [bobEmbed(s.form, "Winner!", `🏆 <@${interaction.user.id}> wins ${coins(coinReward)}${extra}!${dexLine}\n\n${line}\n\nBalance: ${coins(reward.profile.coins)}`)],
    components: [],
  }).catch(() => {});
}

function form_congrats(form: BobForm): string {
  if (form === "blue") return "Enjoy it. I'll want it back later.";
  if (form === "upside") return "You won it yesterday. The coins are just catching up.";
  return "Nicely done. Reflexes of a caffeinated squirrel.";
}

// ── Background scheduler ─────────────────────────────────────────────────────
let started = false;
const SWEEP_MS = 8 * 60_000; // check every 8 minutes

export function startBobEvents(client: Client): void {
  if (started) return;
  started = true;
  setInterval(() => { void sweep(client); }, SWEEP_MS);
}

async function sweep(client: Client): Promise<void> {
  try {
    for (const [, guild] of client.guilds.cache) {
      const settings = await getBobSettings(guild.id).catch(() => null);
      if (!settings || !settings.enabled || !settings.eventsEnabled) continue;
      if (settings.channels.length === 0) continue;      // only fire in configured channels
      if (Math.random() > 0.35) continue;                // ~35% chance per sweep per guild
      const channelId = pick(settings.channels);
      await spawnBobEvent(client, guild.id, channelId, settings).catch(() => {});
    }
  } catch (err) {
    logger.debug({ err }, "bob event sweep error");
  }
}

// Admin "test" trigger.
export async function triggerBobEvent(guildId: string, channelId: string): Promise<boolean> {
  const client = getBotClient();
  if (!client) return false;
  const settings = await getBobSettings(guildId);
  await spawnBobEvent(client, guildId, channelId, settings);
  return true;
}

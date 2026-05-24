import type { Message } from "discord.js";
import {
  updateGuildSettings, getOrCreateGuildSettings, addCard,
} from "../db.js";
import { spawnCard, scheduleNextSpawn } from "../spawn-manager.js";
import { RARITY_EMOJI, RARITY_WEIGHTS, type Rarity } from "../cards-data.js";

// ── Wizard session state ──────────────────────────────────────────────────────
type WizardStep =
  | "choose_type"
  | "channel"
  | "cooldown_number"
  | "cooldown_unit"
  | "cards_per_spawn"
  | "rarity_choice"
  | "rarity_common"
  | "rarity_uncommon"
  | "rarity_rare"
  | "rarity_epic"
  | "rarity_legendary"
  | "test_card_choice"
  | "test_card_name";

interface WizardSession {
  step: WizardStep;
  guildId: string;
  channelId: string;
  lastActivity: number;
  data: {
    setupType?: "quick" | "custom";
    spawnChannelId?: string;
    cooldownNumber?: number;
    cooldownUnit?: "minutes" | "seconds" | "hours" | "days";
    cardsPerSpawn?: number;
    rarityWeights?: Partial<Record<Rarity, number>>;
  };
}

const WIZARD_TIMEOUT_MS = 5 * 60 * 1000;
const sessions = new Map<string, WizardSession>();

function key(guildId: string, userId: string) { return `${guildId}:${userId}`; }

// ── Start wizard ──────────────────────────────────────────────────────────────
export async function startSetupWizard(msg: Message): Promise<void> {
  if (!msg.guild) return;

  sessions.set(key(msg.guild.id, msg.author.id), {
    step: "choose_type",
    guildId: msg.guild.id,
    channelId: msg.channelId,
    lastActivity: Date.now(),
    data: {},
  });

  await msg.reply(
    "## 🃏 DN Cards Setup Wizard\n" +
    "Welcome! Let's configure DN Cards for this server.\n\n" +
    "**1️⃣ Quick Setup** — Just set the drop channel, use sensible defaults\n" +
    "**2️⃣ Custom Setup** — Configure everything step-by-step\n\n" +
    "Type **1** or **2** (or type `cancel` at any time to exit):",
  );
}

// ── Handle wizard step ────────────────────────────────────────────────────────
export async function handleWizardStep(msg: Message): Promise<boolean> {
  if (!msg.guild) return false;

  const sessionKey = key(msg.guild.id, msg.author.id);
  const session = sessions.get(sessionKey);
  if (!session) return false;
  if (msg.channelId !== session.channelId) return false;

  // Timeout
  if (Date.now() - session.lastActivity > WIZARD_TIMEOUT_MS) {
    sessions.delete(sessionKey);
    return false;
  }
  session.lastActivity = Date.now();

  const content = msg.content.trim();

  if (content.toLowerCase() === "cancel") {
    sessions.delete(sessionKey);
    await msg.reply("❌ Setup wizard cancelled. Run `!setup` to start again.");
    return true;
  }

  return processStep(msg, session, sessionKey, content);
}

// ── Step processor ────────────────────────────────────────────────────────────
async function processStep(
  msg: Message, session: WizardSession, sessionKey: string, input: string,
): Promise<boolean> {
  switch (session.step) {

    // ── Choose type ──────────────────────────────────────────────────────────
    case "choose_type": {
      if (input !== "1" && input !== "2") {
        await msg.reply("Please type **1** for Quick Setup or **2** for Custom Setup:");
        return true;
      }
      session.data.setupType = input === "1" ? "quick" : "custom";
      session.step = "channel";
      await msg.reply(
        "📢 **" + (session.data.setupType === "quick" ? "Step 1/2" : "Step 1/6") + " — Drop Channel**\n" +
        "Which channel should DN Cards drop in? Tag it with **#**\n*(e.g. `#general` or `#card-drops`)*",
      );
      return true;
    }

    // ── Channel ──────────────────────────────────────────────────────────────
    case "channel": {
      const channelId = resolveChannel(msg, input);
      if (!channelId) {
        await msg.reply("❌ Channel not found. Please tag an existing text channel like `#card-drops`:");
        return true;
      }
      session.data.spawnChannelId = channelId;

      if (session.data.setupType === "quick") {
        // Quick: skip to test card
        session.step = "test_card_choice";
        await msg.reply(
          "✅ Channel set to <#" + channelId + ">.\n\n" +
          "**Default settings:** 1h interval · 1 card per drop · Standard rarity rates · Catch window 2 min\n\n" +
          "🧪 **Step 2/2 — Test Drop**\n" +
          "Want to make a test card and drop it to <#" + channelId + "> to verify everything works?\n\n" +
          "**1️⃣ Yes, test it!** · **2️⃣ Skip**",
        );
      } else {
        session.step = "cooldown_number";
        await msg.reply(
          "✅ Channel set to <#" + channelId + ">.\n\n" +
          "⏱️ **Step 2/6 — Drop Frequency**\n" +
          "How long between card drops? Enter a number **1–10**:",
        );
      }
      return true;
    }

    // ── Cooldown number ──────────────────────────────────────────────────────
    case "cooldown_number": {
      const n = parseInt(input, 10);
      if (isNaN(n) || n < 1 || n > 10) {
        await msg.reply("❌ Please enter a whole number between **1** and **10**:");
        return true;
      }
      session.data.cooldownNumber = n;
      session.step = "cooldown_unit";
      await msg.reply(
        "**Step 2/6 ─ time unit**\n" +
        "Choose the time unit for **" + n + "**:\n\n" +
        "**1️⃣ Minutes** · **2️⃣ Seconds** · **3️⃣ Hours** · **4️⃣ Days**\n\n" +
        "Type **1**, **2**, **3**, or **4**:",
      );
      return true;
    }

    // ── Cooldown unit ────────────────────────────────────────────────────────
    case "cooldown_unit": {
      const unitMap: Record<string, { unit: WizardSession["data"]["cooldownUnit"]; seconds: number; label: string }> = {
        "1": { unit: "minutes", seconds: 60, label: "minute(s)" },
        "2": { unit: "seconds", seconds: 1, label: "second(s)" },
        "3": { unit: "hours", seconds: 3600, label: "hour(s)" },
        "4": { unit: "days", seconds: 86400, label: "day(s)" },
      };
      const choice = unitMap[input];
      if (!choice) { await msg.reply("Please type **1** (Minutes), **2** (Seconds), **3** (Hours), or **4** (Days):"); return true; }
      session.data.cooldownUnit = choice.unit;
      const totalSeconds = session.data.cooldownNumber! * choice.seconds;
      await updateGuildSettings(session.guildId, { spawnIntervalSeconds: totalSeconds, useRandomInterval: false });

      session.step = "cards_per_spawn";
      await msg.reply(
        "✅ Interval set to **" + session.data.cooldownNumber + " " + choice.label + "**.\n\n" +
        "📦 **Step 3/6 — Cards Per Drop**\n" +
        "How many cards appear each time the timer fires?\n\n" +
        "**1️⃣ 1 card** (default) · **2️⃣ 3 cards** · **3️⃣ 5 cards** · **4️⃣ Random** (1–3 each time)\n\n" +
        "Type **1**, **2**, **3**, or **4**:",
      );
      return true;
    }

    // ── Cards per spawn ──────────────────────────────────────────────────────
    case "cards_per_spawn": {
      const perSpawnMap: Record<string, { value: number; label: string }> = {
        "1": { value: 1, label: "1 card" },
        "2": { value: 3, label: "3 cards" },
        "3": { value: 5, label: "5 cards" },
        "4": { value: -1, label: "Random (1–3)" },
      };
      const choice = perSpawnMap[input];
      if (!choice) { await msg.reply("Please type **1**, **2**, **3**, or **4**:"); return true; }
      session.data.cardsPerSpawn = choice.value;
      await updateGuildSettings(session.guildId, { cardsPerSpawn: choice.value });

      const defaults = "⚪ Common: **60** · 🟢 Uncommon: **25** · 🔵 Rare: **10** · 🟣 Epic: **4** · 🌟 Legendary: **1**";
      session.step = "rarity_choice";
      await msg.reply(
        "✅ Cards per drop set to **" + choice.label + "**.\n\n" +
        "🎲 **Step 4/6 — Rarity Drop Rates**\n" +
        "These weights control how often each rarity appears (higher = more common).\n\n" +
        "Current defaults:\n" + defaults + "\n\n" +
        "**1️⃣ Keep defaults** · **2️⃣ Customize rates**\n\nType **1** or **2**:",
      );
      return true;
    }

    // ── Rarity choice ────────────────────────────────────────────────────────
    case "rarity_choice": {
      if (input === "1") {
        session.step = "test_card_choice";
        await askTestCard(msg, session);
        return true;
      }
      if (input === "2") {
        session.data.rarityWeights = {};
        session.step = "rarity_common";
        await msg.reply(
          "🎲 **Step 4/6 — Rarity Weights (1/5)**\n" +
          `${RARITY_EMOJI.common} Enter the weight for **Common** cards *(default: ${RARITY_WEIGHTS.common}, recommended: 40–80)*:`,
        );
        return true;
      }
      await msg.reply("Please type **1** to keep defaults or **2** to customize:");
      return true;
    }

    // ── Rarity weight inputs ─────────────────────────────────────────────────
    case "rarity_common":
    case "rarity_uncommon":
    case "rarity_rare":
    case "rarity_epic":
    case "rarity_legendary": {
      const w = parseInt(input, 10);
      if (isNaN(w) || w < 0) { await msg.reply("❌ Enter a whole number ≥ 0:"); return true; }

      const order: Array<{ step: WizardStep; rarity: Rarity; next: WizardStep | null; num: string; def: number }> = [
        { step: "rarity_common",    rarity: "common",    next: "rarity_uncommon",  num: "2/5", def: 25  },
        { step: "rarity_uncommon",  rarity: "uncommon",  next: "rarity_rare",      num: "3/5", def: 10  },
        { step: "rarity_rare",      rarity: "rare",      next: "rarity_epic",      num: "4/5", def: 4   },
        { step: "rarity_epic",      rarity: "epic",      next: "rarity_legendary", num: "5/5", def: 1   },
        { step: "rarity_legendary", rarity: "legendary", next: null,               num: "",    def: 0   },
      ];

      const current = order.find(o => o.step === session.step)!;
      session.data.rarityWeights![current.rarity] = w;

      if (current.next) {
        const nextInfo = order.find(o => o.step === current.next)!;
        session.step = current.next;
        await msg.reply(
          `✅ ${RARITY_EMOJI[current.rarity]} ${current.rarity} weight → **${w}**\n\n` +
          `🎲 **Step 4/6 — Rarity Weights (${current.num})**\n` +
          `${RARITY_EMOJI[nextInfo.rarity]} Enter the weight for **${nextInfo.rarity}** cards *(default: ${nextInfo.def})*:`,
        );
      } else {
        // All rarity weights collected — save them
        const rw = session.data.rarityWeights!;
        await updateGuildSettings(session.guildId, {
          rarityWeightCommon: rw.common,
          rarityWeightUncommon: rw.uncommon,
          rarityWeightRare: rw.rare,
          rarityWeightEpic: rw.epic,
          rarityWeightLegendary: rw.legendary,
        });
        session.step = "test_card_choice";
        await askTestCard(msg, session);
      }
      return true;
    }

    // ── Test card choice ─────────────────────────────────────────────────────
    case "test_card_choice": {
      if (input === "1") {
        session.step = "test_card_name";
        await msg.reply(
          "🧪 **Test Drop**\nGive your test card a name *(e.g. `Alpha Test`, `DN-001`)*:",
        );
        return true;
      }
      if (input === "2") {
        await finishWizard(msg, session, sessionKey, null);
        return true;
      }
      await msg.reply("Type **1** to create a test card or **2** to skip:");
      return true;
    }

    // ── Test card name ───────────────────────────────────────────────────────
    case "test_card_name": {
      const name = input.slice(0, 64);
      await finishWizard(msg, session, sessionKey, name);
      return true;
    }

    default:
      sessions.delete(sessionKey);
      return false;
  }
}

// ── Helper: ask test card question ───────────────────────────────────────────
async function askTestCard(msg: Message, session: WizardSession) {
  await msg.reply(
    "🧪 **" + (session.data.setupType === "quick" ? "Step 2/2" : "Step 5/6") + " — Test Drop**\n" +
    "Want to create a test card and drop it to <#" + session.data.spawnChannelId + "> to verify your setup?\n\n" +
    "**1️⃣ Yes, test it!** · **2️⃣ Skip**",
  );
}

// ── Finish wizard ────────────────────────────────────────────────────────────
async function finishWizard(
  msg: Message, session: WizardSession, sessionKey: string, testCardName: string | null,
) {
  sessions.delete(sessionKey);

  const { spawnChannelId } = session.data;
  if (!spawnChannelId) {
    await msg.reply("❌ Setup incomplete — no spawn channel was set. Run `!setup` again.");
    return;
  }

  await updateGuildSettings(session.guildId, {
    spawnChannelId,
    spawnEnabled: true,
  });

  let testCardResult = "";
  if (testCardName) {
    try {
      const card = await addCard({
        name: testCardName,
        description: "A test card created during setup. Safe to remove with `!removecard " + testCardName + "`.",
        rarity: "common",
        cardType: "infantry",
        dropWeight: 60,
        worthValue: 10,
        burnValue: 5,
        droppable: false,
      });
      await spawnCard(session.guildId, card.id, true);
      testCardResult = `\n🧪 Test card **${testCardName}** dropped in <#${spawnChannelId}>! Go catch it.\n*(Remove it later with \`!removecard ${testCardName}\`)*`;
    } catch (err) {
      testCardResult = "\n⚠️ Couldn't create test card — check if a card with that name already exists.";
    }
  }

  scheduleNextSpawn(session.guildId);

  const settings = await getOrCreateGuildSettings(session.guildId);
  const intervalLabel = settings.useRandomInterval
    ? `Random interval`
    : formatTime(settings.spawnIntervalSeconds);
  const cardsLabel = settings.cardsPerSpawn === -1 ? "Random (1–3)" : settings.cardsPerSpawn.toString();

  await msg.reply(
    "## ✅ DN Cards Setup Complete!\n\n" +
    `📢 **Drop channel:** <#${spawnChannelId}>\n` +
    `⏱️ **Interval:** ${intervalLabel}\n` +
    `📦 **Cards per drop:** ${cardsLabel}\n` +
    `🪟 **Catch window:** ${formatTime(settings.catchWindowSeconds)}\n` +
    testCardResult + "\n\n" +
    "Cards are now spawning! Use `!settings` to review your config anytime.\n" +
    "Use `/drop` to force a card drop, `/give` to award cards directly.",
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveChannel(msg: Message, input: string): string | null {
  const mentionId = input?.match(/^<#(\d+)>$/)?.[1];
  if (mentionId) return mentionId;
  const name = input?.replace(/^#/, "");
  const found = msg.guild?.channels.cache.find(c => c.name === name && c.isTextBased());
  return found?.id ?? null;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) { const m = Math.floor(seconds / 60); const s = seconds % 60; return s > 0 ? `${m}m ${s}s` : `${m}m`; }
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

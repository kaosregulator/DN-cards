import type { Message } from "discord.js";
import { addCard } from "../db.js";
import {
  RARITY_EMOJI, RARITY_LABELS, RARITY_WEIGHTS, RARITY_WORTH, RARITY_BURN,
  TYPE_EMOJI,
  type Rarity, type CardType,
} from "../cards-data.js";

// ── Types ─────────────────────────────────────────────────────────────────────
type CardKind = "standard" | "limited" | "event";

type CardWizardStep =
  | "card_name"
  | "card_desc"
  | "card_rarity"
  | "card_ctype"
  | "card_maxcopies"
  | "card_image"
  | "card_confirm";

interface CardWizardSession {
  step: CardWizardStep;
  guildId: string;
  channelId: string;
  lastActivity: number;
  kind: CardKind;
  data: {
    name?: string;
    description?: string;
    rarity?: Rarity;
    cardType?: CardType;
    maxCopies?: number;
    imageUrl?: string;
  };
}

const WIZARD_TIMEOUT_MS = 5 * 60 * 1000;
const sessions = new Map<string, CardWizardSession>();

function key(guildId: string, userId: string) { return `cw:${guildId}:${userId}`; }

const RARITY_CHOICES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const TYPE_CHOICES: CardType[] = [
  "tank", "aircraft", "ship", "vehicle", "infantry",
  "boss", "community", "event", "achievement", "limited",
];

const KIND_LABEL: Record<CardKind, string> = {
  standard: "Standard Card",
  limited: "Limited Edition",
  event: "Event Exclusive",
};

// ── Start card wizard ─────────────────────────────────────────────────────────
export async function startCardWizard(msg: Message, kind: CardKind): Promise<void> {
  if (!msg.guild) return;

  sessions.set(key(msg.guild.id, msg.author.id), {
    step: "card_name",
    guildId: msg.guild.id,
    channelId: msg.channelId,
    lastActivity: Date.now(),
    kind,
    data: {},
  });

  const kindEmoji = kind === "standard" ? "🃏" : kind === "limited" ? "💎" : "🎆";
  await msg.reply(
    `## ${kindEmoji} Card Creation — ${KIND_LABEL[kind]}\n` +
    (kind === "limited" ? "Admin-drop only, capped copies, 4× worth/burn value.\n\n" : "") +
    (kind === "event" ? "Admin-drop only, never spawns randomly, 3× worth/burn value.\n\n" : "") +
    "Type `cancel` at any step to abort.\n\n" +
    "**Step 1 — Name**\nWhat is the card's name?",
  );
}

// ── Handle wizard message ─────────────────────────────────────────────────────
export async function handleCardWizardStep(msg: Message): Promise<boolean> {
  if (!msg.guild) return false;

  const sessionKey = key(msg.guild.id, msg.author.id);
  const session = sessions.get(sessionKey);
  if (!session) return false;
  if (msg.channelId !== session.channelId) return false;

  if (Date.now() - session.lastActivity > WIZARD_TIMEOUT_MS) {
    sessions.delete(sessionKey);
    return false;
  }
  session.lastActivity = Date.now();

  const content = msg.content.trim();

  if (content.toLowerCase() === "cancel") {
    sessions.delete(sessionKey);
    await msg.reply("❌ Card creation cancelled.");
    return true;
  }

  return processStep(msg, session, sessionKey, content);
}

// ── Step processor ────────────────────────────────────────────────────────────
async function processStep(
  msg: Message, session: CardWizardSession, sessionKey: string, input: string,
): Promise<boolean> {
  switch (session.step) {

    // ── Name ──────────────────────────────────────────────────────────────────
    case "card_name": {
      const name = input.slice(0, 64).trim();
      if (name.length < 2) { await msg.reply("❌ Name must be at least 2 characters. Try again:"); return true; }
      session.data.name = name;
      session.step = "card_desc";
      await msg.reply(
        `✅ Name: **${name}**\n\n` +
        "**Step 2 — Description**\nEnter a short description for this card, or type **skip**:",
      );
      return true;
    }

    // ── Description ───────────────────────────────────────────────────────────
    case "card_desc": {
      session.data.description = input.toLowerCase() === "skip" ? "" : input.slice(0, 256).trim();
      session.step = "card_rarity";

      const rarityLines = RARITY_CHOICES.map((r, i) =>
        `**${i + 1}️⃣ ${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}** — 💠 ${RARITY_WORTH[r].toLocaleString()} worth · 🔥 ${RARITY_BURN[r].toLocaleString()} burn`,
      ).join("\n");

      await msg.reply(
        `✅ Description set.\n\n**Step 3 — Rarity**\nChoose a rarity:\n\n${rarityLines}\n\nType **1–5**:`,
      );
      return true;
    }

    // ── Rarity ────────────────────────────────────────────────────────────────
    case "card_rarity": {
      const idx = parseInt(input, 10) - 1;
      if (idx < 0 || idx >= RARITY_CHOICES.length) {
        await msg.reply("❌ Please type a number **1–5**:");
        return true;
      }
      session.data.rarity = RARITY_CHOICES[idx];
      session.step = "card_ctype";

      const typeLines = TYPE_CHOICES.map((t, i) =>
        `**${i + 1}.** ${TYPE_EMOJI[t]} ${t.charAt(0).toUpperCase() + t.slice(1)}`,
      );
      const half = Math.ceil(typeLines.length / 2);
      const col1 = typeLines.slice(0, half).join("\n");
      const col2 = typeLines.slice(half).join("\n");

      await msg.reply(
        `✅ Rarity: ${RARITY_EMOJI[session.data.rarity!]} **${RARITY_LABELS[session.data.rarity!]}**\n\n` +
        `**Step 4 — Card Type**\n${col1}\n${col2}\n\nType **1–${TYPE_CHOICES.length}**:`,
      );
      return true;
    }

    // ── Card Type ─────────────────────────────────────────────────────────────
    case "card_ctype": {
      const idx = parseInt(input, 10) - 1;
      if (idx < 0 || idx >= TYPE_CHOICES.length) {
        await msg.reply(`❌ Please type a number **1–${TYPE_CHOICES.length}**:`);
        return true;
      }
      session.data.cardType = TYPE_CHOICES[idx];

      if (session.kind === "limited") {
        session.step = "card_maxcopies";
        await msg.reply(
          `✅ Type: ${TYPE_EMOJI[session.data.cardType]} **${session.data.cardType}**\n\n` +
          "**Step 5 — Max Copies**\nHow many copies of this card can exist? Enter a number:",
        );
      } else {
        session.step = "card_image";
        await askImage(msg, session);
      }
      return true;
    }

    // ── Max Copies (limited only) ─────────────────────────────────────────────
    case "card_maxcopies": {
      const n = parseInt(input, 10);
      if (isNaN(n) || n < 1) { await msg.reply("❌ Enter a whole number ≥ 1:"); return true; }
      session.data.maxCopies = n;
      session.step = "card_image";
      await askImage(msg, session);
      return true;
    }

    // ── Image ─────────────────────────────────────────────────────────────────
    case "card_image": {
      const attachmentUrl = msg.attachments.first()?.url;
      const isUrl = /^https?:\/\/.+/i.test(input);
      const isSkip = input.toLowerCase() === "skip";

      if (attachmentUrl) {
        session.data.imageUrl = attachmentUrl;
      } else if (isUrl) {
        session.data.imageUrl = input;
      } else if (isSkip) {
        session.data.imageUrl = undefined;
      } else {
        await msg.reply("❌ Please attach an image, paste an image URL, or type **skip**:");
        return true;
      }

      session.step = "card_confirm";
      await showConfirmation(msg, session);
      return true;
    }

    // ── Confirm ───────────────────────────────────────────────────────────────
    case "card_confirm": {
      if (input.toLowerCase() !== "confirm") {
        if (input.toLowerCase() === "cancel") {
          sessions.delete(sessionKey);
          await msg.reply("❌ Card creation cancelled.");
          return true;
        }
        await msg.reply("Type **confirm** to create the card or **cancel** to abort:");
        return true;
      }

      sessions.delete(sessionKey);
      await createCard(msg, session);
      return true;
    }

    default:
      sessions.delete(sessionKey);
      return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function askImage(msg: Message, session: CardWizardSession) {
  const stepNum = session.kind === "limited" ? "6" : "5";
  await msg.reply(
    `**Step ${stepNum} — Image (optional)**\n` +
    "Attach an image to this message, paste a direct image URL, or type **skip**:",
  );
}

async function showConfirmation(msg: Message, session: CardWizardSession) {
  const d = session.data;
  const r = d.rarity!;
  const mult = session.kind === "limited" ? 4 : session.kind === "event" ? 3 : 1;
  const worth = RARITY_WORTH[r] * mult;
  const burn = RARITY_BURN[r] * mult;

  const kindEmoji = session.kind === "standard" ? "🃏" : session.kind === "limited" ? "💎" : "🎆";
  const lines = [
    `**Name:** ${d.name}`,
    `**Kind:** ${kindEmoji} ${KIND_LABEL[session.kind]}`,
    `**Rarity:** ${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}`,
    `**Type:** ${TYPE_EMOJI[d.cardType!]} ${d.cardType}`,
    d.description ? `**Description:** ${d.description}` : "*No description*",
    `**Worth:** 💠 ${worth.toLocaleString()} · **Burn:** 🔥 ${burn.toLocaleString()}`,
    session.kind === "limited" ? `**Max Copies:** ${d.maxCopies}` : "",
    d.imageUrl ? `**Image:** [attached/linked]` : "*No image*",
  ].filter(Boolean).join("\n");

  await msg.reply(
    `**📋 Review your card:**\n${lines}\n\n` +
    "Type **confirm** to create it, or **cancel** to abort:",
  );
}

async function createCard(msg: Message, session: CardWizardSession) {
  const d = session.data;
  const r = d.rarity!;
  const mult = session.kind === "limited" ? 4 : session.kind === "event" ? 3 : 1;

  try {
    const card = await addCard({
      name: d.name!,
      description: d.description ?? "",
      rarity: r,
      cardType: d.cardType!,
      dropWeight: session.kind === "event" ? 0 : RARITY_WEIGHTS[r],
      worthValue: RARITY_WORTH[r] * mult,
      burnValue: RARITY_BURN[r] * mult,
      isLimitedEdition: session.kind === "limited",
      isEventExclusive: session.kind === "event",
      maxCopies: session.kind === "limited" ? d.maxCopies : undefined,
      imageUrl: d.imageUrl,
      droppable: session.kind === "standard",
    });

    const kindEmoji = session.kind === "standard" ? "🃏" : session.kind === "limited" ? "💎" : "🎆";
    const extra = session.kind === "standard"
      ? "It will appear in random card drops automatically."
      : `Use \`/drop name:${card.name}\` to award it to members.`;

    await msg.reply(
      `## ${kindEmoji} Card Created!\n` +
      `**${card.name}** — ${RARITY_EMOJI[r]} ${RARITY_LABELS[r]}\n` +
      `Worth: 💠 ${card.worthValue.toLocaleString()} · Burn: 🔥 ${card.burnValue.toLocaleString()}\n\n` +
      extra +
      (session.kind !== "standard" ? `\nRemove with \`!removecard ${card.name}\` if needed.` : ""),
    );
  } catch (err: any) {
    const isDuplicate = err?.message?.includes("unique") || err?.code === "23505";
    await msg.reply(isDuplicate
      ? `❌ A card named **${d.name}** already exists. Use \`!removecard ${d.name}\` first.`
      : "❌ Failed to create the card. Please try again.",
    );
  }
}

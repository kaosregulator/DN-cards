// Discord panels for the egg counter, bag, dex, and stable.

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} from "discord.js";
import { SPECIES_META, listUserPets, stageLabel, type PetSpecies } from "./engine.js";
import {
  describeEgg,
  eggTiming,
  ensureDailyDrop,
  incomingOffers,
  listDex,
  listEggs,
} from "./collect.js";
import {
  eggDef,
  formatTimer,
  HATCH_ITEMS,
  LIMITED_SUPPLY,
  shopEggs,
  VARIANT_LABEL,
  DISCOVERY_VARIANTS,
  type DiscoveryVariant,
} from "./catalog.js";
import { PET_SPECIES, db, petOwnedEggsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { renderEggFocusGif, renderShopGif } from "./render.js";

const UB_ICON =
  "https://cdn.discordapp.com/avatars/292953664492929025/e81ffdbb910a3757b874a890b2a92740.webp?size=64";

function petId(action: string, ownerId: string, extra?: string | number) {
  return extra != null ? `pet:${action}:${ownerId}:${extra}` : `pet:${action}:${ownerId}`;
}

export async function shopPayload(guildId: string, ownerId: string) {
  const drop = await ensureDailyDrop(guildId);
  const limited = eggDef(drop.eggKey);
  const left = Math.max(0, Math.min(LIMITED_SUPPLY, drop.totalSupply) - drop.claimed);
  const shop = shopEggs();
  const sprites = [limited?.sprite, ...shop.slice(0, 3).map(e => e.sprite)].filter((s): s is string => !!s);
  const gif = await renderShopGif(sprites);
  const files: AttachmentBuilder[] = [];
  const lines = shop.map(e => `• **${e.label}** — ${e.price} cash · ${formatTimer(e.timerMs)} · sell ${e.sellValue}`);
  if (limited) {
    lines.unshift(
      left > 0
        ? `🌟 **${limited.label}** — ${limited.price} cash · **${left}/${LIMITED_SUPPLY} left today** · ${formatTimer(limited.timerMs)}\n_${limited.blurb}_`
        : `🌟 **${limited.label}** — **SOLD OUT** (${LIMITED_SUPPLY}/${LIMITED_SUPPLY}). Trade is the only way.`,
    );
  }
  const embed = new EmbedBuilder()
    .setColor(left > 0 ? 0xf5c84c : 0x64748b)
    .setAuthor({ name: "UnbelievaBoat cash", iconURL: UB_ICON })
    .setTitle("🥚 Egg Counter")
    .setDescription(
      [
        "What's inside stays a secret until the timer ends.",
        "Shiny and exotic are rolled at the crack — not when you pay.",
        "",
        ...lines,
      ].join("\n"),
    )
    .setFooter({ text: "Limited supply is hardcoded at 3. Admins cannot mint more. Idle panels close in 1m." });
  if (gif?.buffer) {
    files.push(new AttachmentBuilder(gif.buffer, { name: "eggs.gif" }));
    embed.setImage("attachment://eggs.gif");
  }
  const options = [
    ...shop.map(e => ({
      label: `${e.label} — ${e.price}`,
      value: `egg:${e.key}`,
      description: e.blurb.slice(0, 100),
    })),
    ...(limited && left > 0
      ? [{
          label: `${limited.label} — ${limited.price} LIMITED`,
          value: `lim:${limited.key}`,
          description: `${left} of ${LIMITED_SUPPLY} left today`,
        }]
      : []),
    ...HATCH_ITEMS.map(i => ({
      label: `${i.label} — ${i.price}`,
      value: `item:${i.key}`,
      description: i.blurb,
    })),
    {
      label: "Skip growth — from 800",
      value: "item:stage_skip",
      description: "Pay UB cash to advance your active pet one stage",
    },
  ];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(petId("buyegg", ownerId))
    .setPlaceholder("Buy an egg or a timer item…")
    .addOptions(options.slice(0, 25));
  return {
    embeds: [embed],
    files,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(petId("eggs", ownerId)).setLabel("My eggs").setEmoji("🧺").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(petId("refresh", ownerId)).setLabel("Pet hub").setEmoji("🐾").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function eggsPayload(guildId: string, ownerId: string, focusId?: number) {
  const eggs = await listEggs(guildId, ownerId);
  const offers = await incomingOffers(guildId, ownerId);
  const focus = focusId ? eggs.find(e => e.id === focusId) : eggs[0];
  const files: AttachmentBuilder[] = [];
  const labeledOffers: string[] = [];
  for (const o of offers) {
    const [row] = await db.select().from(petOwnedEggsTable).where(eq(petOwnedEggsTable.id, o.eggId)).limit(1);
    const label = row ? (eggDef(row.eggKey)?.label ?? row.eggKey) : "egg";
    labeledOffers.push(`• **${label}** from <@${o.fromId}> · tax **${o.tax}** · offer ${o.id}`);
  }

  const body = eggs.length
    ? eggs.slice(0, 12).map(e => describeEgg(e)).join("\n")
    : "_No eggs yet. Open the counter and buy one._";
  const embed = new EmbedBuilder()
    .setColor(0x60a5fa)
    .setAuthor({ name: "UnbelievaBoat cash", iconURL: UB_ICON })
    .setTitle("🧺 Your eggs")
    .setDescription([body, labeledOffers.length ? `\n**Incoming trades**\n${labeledOffers.join("\n")}` : ""].join("\n"))
    .setFooter({ text: "Sell pays you. Trade moves the egg and sinks a small tax. Hatched eggs are gone." });

  if (focus) {
    const def = eggDef(focus.eggKey);
    const timing = eggTiming(focus);
    const sub = focus.status === "held"
      ? "In your bag — start the timer"
      : timing.ready
        ? "READY — name it and crack it"
        : `${formatTimer(timing.leftMs)} left · keeps counting offline`;
    if (def) {
      const gif = await renderEggFocusGif(def.sprite, def.label, sub);
      if (gif?.buffer) {
        files.push(new AttachmentBuilder(gif.buffer, { name: "egg.gif" }));
        embed.setImage("attachment://egg.gif");
      }
    }
  }

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (eggs.length) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(petId("pickegg", ownerId))
        .setPlaceholder("Choose an egg…")
        .addOptions(eggs.slice(0, 25).map(e => ({
          label: describeEgg(e).slice(0, 100),
          value: String(e.id),
        }))),
    ));
  }
  if (focus) {
    const timing = eggTiming(focus);
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (focus.status === "held") {
      row.addComponents(
        new ButtonBuilder().setCustomId(petId("incubate", ownerId, focus.id)).setLabel("Incubate").setEmoji("🔥").setStyle(ButtonStyle.Success),
      );
    } else if (timing.ready) {
      row.addComponents(
        new ButtonBuilder().setCustomId(petId("hatchgo", ownerId, focus.id)).setLabel("Hatch").setEmoji("✨").setStyle(ButtonStyle.Success),
      );
    } else {
      row.addComponents(
        new ButtonBuilder().setCustomId(petId("sand", ownerId, focus.id)).setLabel("Time Sand").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(petId("crackitem", ownerId, focus.id)).setLabel("Instant Crack").setStyle(ButtonStyle.Primary),
      );
    }
    row.addComponents(
      new ButtonBuilder().setCustomId(petId("sellask", ownerId, focus.id)).setLabel("Sell").setEmoji("💰").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(petId("tradeask", ownerId, focus.id)).setLabel("Trade").setEmoji("🤝").setStyle(ButtonStyle.Secondary),
    );
    components.push(row);
  }
  if (offers.length) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const o of offers.slice(0, 2)) {
      row.addComponents(
        new ButtonBuilder().setCustomId(`pet:eggok:${o.id}`).setLabel(`Accept #${o.id}`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pet:eggnah:${o.id}`).setLabel(`Nah #${o.id}`).setStyle(ButtonStyle.Secondary),
      );
    }
    components.push(row);
  }
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(petId("eggshop", ownerId)).setLabel("Egg counter").setEmoji("🥚").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(petId("refresh", ownerId)).setLabel("Pet hub").setEmoji("🐾").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], files, components };
}

export async function dexPayload(guildId: string, ownerId: string) {
  const rows = await listDex(guildId, ownerId);
  const lines: string[] = [];
  for (const species of PET_SPECIES) {
    const em = SPECIES_META[species as PetSpecies]?.emoji ?? "🐾";
    const bits = DISCOVERY_VARIANTS.map(v => {
      const hit = rows.find(r => r.species === species && r.discoveryVariant === v);
      const mark = hit ? `×${hit.ownedCount}` : "—";
      return `${VARIANT_LABEL[v as DiscoveryVariant]} ${mark}`;
    });
    lines.push(`${em} **${SPECIES_META[species as PetSpecies]?.label ?? species}** · ${bits.join(" · ")}`);
  }
  const found = rows.length;
  const embed = new EmbedBuilder()
    .setColor(0xa78bfa)
    .setAuthor({ name: "UnbelievaBoat cash", iconURL: UB_ICON })
    .setTitle("📖 Petdex")
    .setDescription(lines.join("\n") + `\n\n**${found}/12** discoveries. Duplicates stack.`)
    .setFooter({ text: "Shiny and exotic look different — gold sparkle or violet glow." });
  return {
    embeds: [embed],
    files: [] as AttachmentBuilder[],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(petId("eggshop", ownerId)).setLabel("Egg counter").setEmoji("🥚").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(petId("stable", ownerId)).setLabel("Stable").setEmoji("🏠").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function stablePayload(guildId: string, ownerId: string) {
  const pets = await listUserPets(guildId, ownerId);
  const lines = pets.length
    ? pets.slice(0, 15).map(p => {
        const em = SPECIES_META[p.species as PetSpecies]?.emoji ?? "🐾";
        const star = p.isActive ? "★ " : "";
        const disc = p.discoveryVariant && p.discoveryVariant !== "normal" ? ` ${p.discoveryVariant}` : "";
        const dead = p.isDead ? " · passed on" : "";
        return `${star}${em} **${p.name}** · ${stageLabel(p.stage)}${disc}${dead} · #${p.id}`;
      }).join("\n")
    : "_No companions yet. Hatch an egg._";
  const living = pets.filter(p => !p.isDead);
  const embed = new EmbedBuilder()
    .setColor(0x34d399)
    .setAuthor({ name: "UnbelievaBoat cash", iconURL: UB_ICON })
    .setTitle("🏠 Stable")
    .setDescription(lines)
    .setFooter({ text: "Hatching sets the new pet active. Switch here anytime." });
  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (living.length) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(petId("activate", ownerId))
        .setPlaceholder("Set active pet…")
        .addOptions(living.slice(0, 25).map(p => ({
          label: `${p.isActive ? "★ " : ""}${p.name}`.slice(0, 100),
          value: String(p.id),
          description: `${p.species} · ${p.stage}`.slice(0, 100),
        }))),
    ));
  }
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(petId("replay", ownerId)).setLabel("Replay hatch").setEmoji("🎬").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(petId("refresh", ownerId)).setLabel("Pet hub").setEmoji("🐾").setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], files: [] as AttachmentBuilder[], components };
}

// Endless hatch & collect — eggs are inventory objects.
// Mystery species/variant is rolled when the timer completes, never at purchase.
// Daily limited supply is hardcoded (LIMITED_SUPPLY). Admins cannot mint or raise it.

import {
  db,
  pool,
  petsTable,
  petOwnedEggsTable,
  petDexTable,
  petUserItemsTable,
  petLimitedDropsTable,
  petEggOffersTable,
  type Pet,
  type PetOwnedEgg,
  type PetDexEntry,
  type PetLimitedDrop,
  type PetEggOffer,
} from "@workspace/db";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  chargeUbCash,
  creditUbCash,
  getOrCreatePetSettings,
  PET_SPECIES,
  type PetSpecies,
} from "./engine.js";
import {
  eggDef,
  formatTimer,
  limitedEggFor,
  LIMITED_SUPPLY,
  rollWeighted,
  utcDateKey,
  type DiscoveryVariant,
  type EggDef,
} from "./catalog.js";

const TRADE_TAX = 0.15;

export function tradeTaxOf(sellValue: number): number {
  if (sellValue <= 0) return 0;
  return Math.max(1, Math.ceil(sellValue * TRADE_TAX));
}

/** Regular sinks: missing token does not block play. Insufficient cash still throws. */
async function chargeSoft(guildId: string, userId: string, amount: number, reason: string): Promise<number> {
  try {
    return await chargeUbCash(guildId, userId, amount, reason);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Not enough UnbelievaBoat cash/i.test(msg)) throw err;
    return 0;
  }
}

/** Limited eggs must take a real UB charge. No soft-free mint. */
async function chargeStrict(guildId: string, userId: string, amount: number, reason: string): Promise<number> {
  const charged = await chargeUbCash(guildId, userId, amount, reason);
  if (amount > 0 && charged <= 0) {
    throw new Error("Limited eggs need a live UnbelievaBoat charge. They cannot be minted for free.");
  }
  return charged;
}

export async function ensureDailyDrop(guildId: string, date = utcDateKey()): Promise<PetLimitedDrop> {
  const egg = limitedEggFor(guildId, date);
  await db.insert(petLimitedDropsTable).values({
    guildId,
    releaseDate: date,
    eggKey: egg.key,
    totalSupply: LIMITED_SUPPLY,
    claimed: 0,
  }).onConflictDoNothing({ target: [petLimitedDropsTable.guildId, petLimitedDropsTable.releaseDate] });

  const [row] = await db.select().from(petLimitedDropsTable).where(and(
    eq(petLimitedDropsTable.guildId, guildId),
    eq(petLimitedDropsTable.releaseDate, date),
  )).limit(1);
  if (!row) throw new Error("Could not open today's limited drop.");
  // Supply is code, not a knob. If an old row drifted, snap the cap back down
  // without ever increasing claimed or minting extras.
  if (row.totalSupply !== LIMITED_SUPPLY) {
    const [fixed] = await db.update(petLimitedDropsTable).set({
      totalSupply: LIMITED_SUPPLY,
    }).where(eq(petLimitedDropsTable.id, row.id)).returning();
    return fixed ?? row;
  }
  return row;
}

async function claimLimitedSlot(guildId: string, date: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE pet_limited_drops
        SET claimed = claimed + 1
      WHERE guild_id = $1
        AND release_date = $2
        AND claimed < total_supply
        AND total_supply <= $3
      RETURNING id`,
    [guildId, date, LIMITED_SUPPLY],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function buyEgg(
  guildId: string,
  userId: string,
  eggKey: string,
): Promise<{ egg: PetOwnedEgg; charged: number; def: EggDef }> {
  const settings = await getOrCreatePetSettings(guildId);
  if (!settings.enabled) throw new Error("Pets are disabled in this server.");
  const def = eggDef(eggKey);
  if (!def) throw new Error("Unknown egg.");

  if (def.limited) {
    const date = utcDateKey();
    const drop = await ensureDailyDrop(guildId, date);
    if (drop.eggKey !== def.key) throw new Error("That limited egg is not today's drop.");
    if (drop.claimed >= drop.totalSupply) {
      throw new Error(`Sold out. Only ${LIMITED_SUPPLY} ${def.label}s exist today — trade for one.`);
    }
    const charged = await chargeStrict(guildId, userId, def.price, `Limited egg: ${def.label}`);
    const won = await claimLimitedSlot(guildId, date);
    if (!won) {
      if (charged > 0) await creditUbCash(guildId, userId, charged, `Refund: ${def.label} sold out`);
      throw new Error(`Sold out. Only ${LIMITED_SUPPLY} exist today — the only way left is to trade.`);
    }
    try {
      const [egg] = await db.insert(petOwnedEggsTable).values({
        guildId,
        ownerId: userId,
        eggKey: def.key,
        status: "held",
        limitedDate: date,
        sellValue: def.sellValue,
      }).returning();
      return { egg: egg!, charged, def };
    } catch (err) {
      await pool.query(
        `UPDATE pet_limited_drops
            SET claimed = GREATEST(claimed - 1, 0)
          WHERE guild_id = $1 AND release_date = $2`,
        [guildId, date],
      );
      if (charged > 0) await creditUbCash(guildId, userId, charged, `Refund: ${def.label} failed`);
      throw err;
    }
  }

  if (!def.shop) throw new Error("That egg is not for sale.");
  const charged = await chargeSoft(guildId, userId, def.price, `Egg shop: ${def.label}`);
  const [egg] = await db.insert(petOwnedEggsTable).values({
    guildId,
    ownerId: userId,
    eggKey: def.key,
    status: "held",
    sellValue: def.sellValue,
  }).returning();
  return { egg: egg!, charged, def };
}

export async function listEggs(guildId: string, userId: string): Promise<PetOwnedEgg[]> {
  return db.select().from(petOwnedEggsTable).where(and(
    eq(petOwnedEggsTable.guildId, guildId),
    eq(petOwnedEggsTable.ownerId, userId),
    ne(petOwnedEggsTable.status, "hatched"),
    ne(petOwnedEggsTable.status, "sold"),
  )).orderBy(desc(petOwnedEggsTable.obtainedAt));
}

export async function getOwnedEgg(guildId: string, userId: string, eggId: number): Promise<PetOwnedEgg> {
  const [egg] = await db.select().from(petOwnedEggsTable).where(and(
    eq(petOwnedEggsTable.id, eggId),
    eq(petOwnedEggsTable.guildId, guildId),
    eq(petOwnedEggsTable.ownerId, userId),
  )).limit(1);
  if (!egg || egg.status === "hatched" || egg.status === "sold") throw new Error("That egg is gone.");
  return egg;
}

export function eggTiming(egg: PetOwnedEgg, now = Date.now()): { ready: boolean; leftMs: number } {
  if (egg.status !== "incubating" || !egg.readyAt) return { ready: false, leftMs: 0 };
  const leftMs = egg.readyAt.getTime() - now;
  return { ready: leftMs <= 0, leftMs: Math.max(0, leftMs) };
}

export async function startIncubate(guildId: string, userId: string, eggId: number): Promise<PetOwnedEgg> {
  const egg = await getOwnedEgg(guildId, userId, eggId);
  if (egg.status === "incubating") return egg;
  const def = eggDef(egg.eggKey);
  if (!def) throw new Error("This egg's catalog entry is missing.");
  const started = new Date();
  const ready = new Date(started.getTime() + def.timerMs);
  const [row] = await db.update(petOwnedEggsTable).set({
    status: "incubating",
    incubateStartedAt: started,
    readyAt: ready,
  }).where(eq(petOwnedEggsTable.id, egg.id)).returning();
  return row!;
}

async function addUserItem(guildId: string, userId: string, itemKey: string, qty: number) {
  const [existing] = await db.select().from(petUserItemsTable).where(and(
    eq(petUserItemsTable.guildId, guildId),
    eq(petUserItemsTable.userId, userId),
    eq(petUserItemsTable.itemKey, itemKey),
  )).limit(1);
  if (existing) {
    await db.update(petUserItemsTable).set({ qty: existing.qty + qty }).where(eq(petUserItemsTable.id, existing.id));
  } else {
    await db.insert(petUserItemsTable).values({ guildId, userId, itemKey, qty });
  }
}

async function takeUserItem(guildId: string, userId: string, itemKey: string) {
  const [existing] = await db.select().from(petUserItemsTable).where(and(
    eq(petUserItemsTable.guildId, guildId),
    eq(petUserItemsTable.userId, userId),
    eq(petUserItemsTable.itemKey, itemKey),
  )).limit(1);
  if (!existing || existing.qty <= 0) throw new Error(`You don't have a ${itemKey.replaceAll("_", " ")}.`);
  await db.update(petUserItemsTable).set({ qty: existing.qty - 1 }).where(eq(petUserItemsTable.id, existing.id));
}

export async function listUserItems(guildId: string, userId: string) {
  return db.select().from(petUserItemsTable).where(and(
    eq(petUserItemsTable.guildId, guildId),
    eq(petUserItemsTable.userId, userId),
  ));
}

export async function buyHatchItem(guildId: string, userId: string, itemKey: "time_sand" | "instant_crack", price: number, label: string) {
  const charged = await chargeSoft(guildId, userId, price, `Hatch item: ${label}`);
  await addUserItem(guildId, userId, itemKey, 1);
  return charged;
}

export async function applyHatchItem(guildId: string, userId: string, eggId: number, itemKey: "time_sand" | "instant_crack"): Promise<PetOwnedEgg> {
  const egg = await getOwnedEgg(guildId, userId, eggId);
  if (egg.status !== "incubating" || !egg.readyAt) throw new Error("Start incubation before using that.");
  await takeUserItem(guildId, userId, itemKey);
  const now = Date.now();
  let ready = egg.readyAt.getTime();
  if (itemKey === "instant_crack") ready = now;
  else ready = now + Math.ceil(Math.max(0, ready - now) / 2);
  const [row] = await db.update(petOwnedEggsTable).set({
    readyAt: new Date(ready),
  }).where(eq(petOwnedEggsTable.id, egg.id)).returning();
  return row!;
}

export async function sellEgg(guildId: string, userId: string, eggId: number): Promise<{ paid: number; label: string }> {
  const egg = await getOwnedEgg(guildId, userId, eggId);
  const def = eggDef(egg.eggKey);
  const paid = await creditUbCash(guildId, userId, egg.sellValue, `Sold egg: ${def?.label ?? egg.eggKey}`);
  await db.update(petOwnedEggsTable).set({ status: "sold" }).where(eq(petOwnedEggsTable.id, egg.id));
  await db.update(petEggOffersTable).set({ status: "cancelled" }).where(and(
    eq(petEggOffersTable.eggId, egg.id),
    eq(petEggOffersTable.status, "pending"),
  ));
  return { paid, label: def?.label ?? egg.eggKey };
}

export async function offerEgg(guildId: string, fromId: string, toId: string, eggId: number): Promise<PetEggOffer> {
  if (fromId === toId) throw new Error("You already own that egg.");
  const egg = await getOwnedEgg(guildId, fromId, eggId);
  await db.update(petEggOffersTable).set({ status: "cancelled" }).where(and(
    eq(petEggOffersTable.eggId, egg.id),
    eq(petEggOffersTable.status, "pending"),
  ));
  const [offer] = await db.insert(petEggOffersTable).values({
    guildId,
    eggId: egg.id,
    fromId,
    toId,
    tax: tradeTaxOf(egg.sellValue),
    status: "pending",
  }).returning();
  return offer!;
}

export async function declineOffer(offerId: number, userId: string): Promise<void> {
  const [offer] = await db.select().from(petEggOffersTable).where(eq(petEggOffersTable.id, offerId)).limit(1);
  if (!offer || offer.status !== "pending") throw new Error("That offer is gone.");
  if (offer.toId !== userId && offer.fromId !== userId) throw new Error("That offer isn't yours.");
  await db.update(petEggOffersTable).set({ status: "declined" }).where(eq(petEggOffersTable.id, offer.id));
}

export async function acceptOffer(offerId: number, userId: string): Promise<{ egg: PetOwnedEgg; tax: number }> {
  const [offer] = await db.select().from(petEggOffersTable).where(eq(petEggOffersTable.id, offerId)).limit(1);
  if (!offer || offer.status !== "pending") throw new Error("That offer is gone.");
  if (offer.toId !== userId) throw new Error("This trade was offered to someone else.");
  const [egg] = await db.select().from(petOwnedEggsTable).where(and(
    eq(petOwnedEggsTable.id, offer.eggId),
    eq(petOwnedEggsTable.guildId, offer.guildId),
    eq(petOwnedEggsTable.ownerId, offer.fromId),
  )).limit(1);
  if (!egg || egg.status === "hatched" || egg.status === "sold") throw new Error("That egg was already hatched or sold.");
  let tax = 0;
  if (offer.tax > 0) {
    try {
      tax = await chargeUbCash(offer.guildId, userId, offer.tax, "Egg trade tax");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Not enough UnbelievaBoat cash/i.test(msg)) throw err;
      // No live token: the trade still moves the egg, and nothing is minted.
      tax = 0;
    }
  }
  const [moved] = await db.update(petOwnedEggsTable).set({ ownerId: userId }).where(and(
    eq(petOwnedEggsTable.id, egg.id),
    eq(petOwnedEggsTable.ownerId, offer.fromId),
  )).returning();
  if (!moved) throw new Error("The egg moved before you could accept.");
  await db.update(petEggOffersTable).set({ status: "accepted" }).where(eq(petEggOffersTable.id, offer.id));
  await db.update(petEggOffersTable).set({ status: "cancelled" }).where(and(
    eq(petEggOffersTable.eggId, egg.id),
    eq(petEggOffersTable.status, "pending"),
  ));
  return { egg: moved, tax };
}

export async function incomingOffers(guildId: string, userId: string): Promise<PetEggOffer[]> {
  return db.select().from(petEggOffersTable).where(and(
    eq(petEggOffersTable.guildId, guildId),
    eq(petEggOffersTable.toId, userId),
    eq(petEggOffersTable.status, "pending"),
  )).orderBy(desc(petEggOffersTable.createdAt)).limit(5);
}

async function bumpDex(guildId: string, userId: string, species: string, discoveryVariant: string) {
  const [existing] = await db.select().from(petDexTable).where(and(
    eq(petDexTable.guildId, guildId),
    eq(petDexTable.userId, userId),
    eq(petDexTable.species, species),
    eq(petDexTable.discoveryVariant, discoveryVariant),
  )).limit(1);
  if (existing) {
    await db.update(petDexTable).set({ ownedCount: existing.ownedCount + 1 }).where(eq(petDexTable.id, existing.id));
  } else {
    await db.insert(petDexTable).values({ guildId, userId, species, discoveryVariant, ownedCount: 1 });
  }
}

export async function listDex(guildId: string, userId: string): Promise<PetDexEntry[]> {
  return db.select().from(petDexTable).where(and(
    eq(petDexTable.guildId, guildId),
    eq(petDexTable.userId, userId),
  ));
}

export async function completeHatch(
  guildId: string,
  userId: string,
  eggId: number,
  name: string,
): Promise<{ pet: Pet; def: EggDef; species: PetSpecies; discovery: DiscoveryVariant }> {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) throw new Error("Give your hatchling a name.");
  const egg = await getOwnedEgg(guildId, userId, eggId);
  const timing = eggTiming(egg);
  if (egg.status !== "incubating" || !timing.ready) {
    const left = egg.readyAt ? formatTimer(egg.readyAt.getTime() - Date.now()) : "not started";
    throw new Error(`Still incubating (${left}). Wall-clock timer keeps running while you're offline.`);
  }
  const def = eggDef(egg.eggKey);
  if (!def) throw new Error("This egg's catalog entry is missing.");

  const species = rollWeighted<PetSpecies>(def.species);
  if (!PET_SPECIES.includes(species)) throw new Error("The egg rolled an unknown creature.");
  const discovery = rollWeighted<DiscoveryVariant>(def.discover);
  const hatchedAt = new Date();
  const bonus = discovery === "exotic" ? 8 : discovery === "shiny" ? 4 : 0;

  await db.update(petsTable).set({ isActive: false, updatedAt: new Date() }).where(and(
    eq(petsTable.guildId, guildId),
    eq(petsTable.userId, userId),
    eq(petsTable.isActive, true),
  ));

  const [pet] = await db.insert(petsTable).values({
    guildId,
    userId,
    name: trimmed,
    species,
    variant: Math.floor(Math.random() * 4),
    stage: "hatchling",
    hunger: 85,
    cleanliness: 90,
    happiness: discovery === "exotic" ? 100 : 90,
    health: 100,
    level: 1,
    xp: 10 + bonus,
    power: 12 + bonus,
    inventory: { food: 2, soap: 1 },
    cosmetics: [],
    lastTickAt: hatchedAt,
    stageStartedAt: hatchedAt,
    hatchedAt,
    discoveryVariant: discovery,
    isActive: true,
    eggKey: def.key,
    hatchReplay: {
      eggKey: def.key,
      species,
      discoveryVariant: discovery,
      name: trimmed,
      hatchedAt: hatchedAt.toISOString(),
    },
  }).returning();

  await db.update(petOwnedEggsTable).set({
    status: "hatched",
    pendingName: trimmed,
    hatchedPetId: pet!.id,
  }).where(eq(petOwnedEggsTable.id, egg.id));

  await bumpDex(guildId, userId, species, discovery);
  return { pet: pet!, def, species, discovery };
}

const STAGE_SKIP_COST: Record<string, number> = {
  hatchling: 800,
  juvenile: 2500,
};

export async function skipStage(guildId: string, userId: string): Promise<{ pet: Pet; charged: number }> {
  const { getPet, tickPet } = await import("./engine.js");
  const { PET_STAGES } = await import("@workspace/db");
  let pet = await getPet(guildId, userId);
  if (!pet || pet.isDead) throw new Error("You need a living pet to skip a stage.");
  pet = await tickPet(pet);
  const cost = STAGE_SKIP_COST[pet.stage];
  if (!cost) throw new Error(pet.stage === "adult" ? "Already fully grown." : "This stage can't be skipped.");
  const charged = await chargeSoft(guildId, userId, cost, `Skip ${pet.stage} growth`);
  const idx = PET_STAGES.indexOf(pet.stage as typeof PET_STAGES[number]);
  const next = PET_STAGES[idx + 1];
  if (!next) throw new Error("Already fully grown.");
  const [updated] = await db.update(petsTable).set({
    stage: next,
    stageStartedAt: new Date(),
    xp: pet.xp + 40,
    power: pet.power + 8,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();
  return { pet: updated!, charged };
}

export async function setActivePet(guildId: string, userId: string, petId: number): Promise<Pet> {
  const [pet] = await db.select().from(petsTable).where(and(
    eq(petsTable.id, petId),
    eq(petsTable.guildId, guildId),
    eq(petsTable.userId, userId),
  )).limit(1);
  if (!pet) throw new Error("That pet isn't in your stable.");
  if (pet.isDead) throw new Error("That companion has passed on.");
  await db.update(petsTable).set({ isActive: false, updatedAt: new Date() }).where(and(
    eq(petsTable.guildId, guildId),
    eq(petsTable.userId, userId),
    eq(petsTable.isActive, true),
  ));
  const [updated] = await db.update(petsTable).set({ isActive: true, updatedAt: new Date() }).where(eq(petsTable.id, pet.id)).returning();
  return updated!;
}

export function describeEgg(egg: PetOwnedEgg): string {
  const def = eggDef(egg.eggKey);
  const label = def?.label ?? egg.eggKey;
  const lim = egg.limitedDate ? " · LIMITED" : "";
  if (egg.status === "held") return `#${egg.id} ${label}${lim} — in your bag`;
  const timing = eggTiming(egg);
  if (timing.ready) return `#${egg.id} ${label}${lim} — READY to hatch`;
  return `#${egg.id} ${label}${lim} — ${formatTimer(timing.leftMs)} left`;
}

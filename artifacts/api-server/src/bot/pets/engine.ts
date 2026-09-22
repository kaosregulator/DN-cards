// Pet care engine — decay, growth, death, challenges. Addon-only; never touches
// DN Cards currency tables. Optional UnbelievaBoat cash spend via ubApi.

import {
  db,
  petsTable,
  petSettingsTable,
  petChallengesTable,
  petCareLogTable,
  PET_SPECIES,
  PET_STAGES,
  type Pet,
  type PetSettings,
  type PetSpecies,
  type PetStage,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { isUbConfigured, ubApi } from "../../lib/unbelievaboat/client.js";
import { getOrCreateUbSettings } from "../../lib/unbelievaboat/db.js";

const CLAMP = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

export const SPECIES_META: Record<PetSpecies, { emoji: string; label: string; hues: [string, string][] }> = {
  dragon: {
    emoji: "🐉",
    label: "Dragon",
    hues: [
      ["#c84b31", "#f2c14e"],
      ["#2f6fed", "#7ec8ff"],
      ["#3d8b5a", "#b6e388"],
      ["#7b3fe4", "#d4b5ff"],
    ],
  },
  cat: {
    emoji: "🐱",
    label: "Cat",
    hues: [
      ["#d4a574", "#fff3e0"],
      ["#6b7280", "#e5e7eb"],
      ["#111827", "#fbbf24"],
      ["#f472b6", "#fce7f3"],
    ],
  },
  dog: {
    emoji: "🐶",
    label: "Dog",
    hues: [
      ["#a16207", "#fde68a"],
      ["#78716c", "#e7e5e4"],
      ["#1e3a5f", "#93c5fd"],
      ["#7c2d12", "#fdba74"],
    ],
  },
  hamster: {
    emoji: "🐹",
    label: "Hamster",
    hues: [
      ["#e8a87c", "#fff1e0"],
      ["#c4a484", "#f5e6d3"],
      ["#8b5e3c", "#ffe4c4"],
      ["#d97706", "#fef3c7"],
    ],
  },
};

export async function getOrCreatePetSettings(guildId: string): Promise<PetSettings> {
  const existing = await db.select().from(petSettingsTable).where(eq(petSettingsTable.guildId, guildId)).limit(1);
  if (existing[0]) return existing[0];
  const [row] = await db.insert(petSettingsTable).values({ guildId }).returning();
  return row!;
}

export async function updatePetSettings(
  guildId: string,
  patch: Partial<Omit<PetSettings, "id" | "guildId" | "createdAt" | "updatedAt">>,
): Promise<PetSettings> {
  await getOrCreatePetSettings(guildId);
  const [row] = await db.update(petSettingsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(petSettingsTable.guildId, guildId))
    .returning();
  return row!;
}

export async function getPet(guildId: string, userId: string): Promise<Pet | null> {
  const rows = await db.select().from(petsTable)
    .where(and(eq(petsTable.guildId, guildId), eq(petsTable.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPetById(id: number): Promise<Pet | null> {
  const rows = await db.select().from(petsTable).where(eq(petsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listAlivePets(guildId: string, limit = 25): Promise<Pet[]> {
  return db.select().from(petsTable)
    .where(and(eq(petsTable.guildId, guildId), eq(petsTable.isDead, false)))
    .orderBy(desc(petsTable.power), desc(petsTable.wins))
    .limit(limit);
}

async function logCare(guildId: string, petId: number, userId: string, action: string, detail: Record<string, unknown> = {}) {
  await db.insert(petCareLogTable).values({ guildId, petId, userId, action, detail });
}

/** Apply time-based decay + growth. Safe to call on every view/action. */
export async function tickPet(pet: Pet, settings?: PetSettings): Promise<Pet> {
  if (pet.isDead) return pet;
  const cfg = settings ?? await getOrCreatePetSettings(pet.guildId);
  const now = Date.now();
  const last = pet.lastTickAt?.getTime() ?? now;
  const hours = Math.max(0, (now - last) / 3_600_000);
  if (hours < 0.05) return pet; // ~3 minutes — skip tiny ticks

  let hunger = CLAMP(pet.hunger - hours * cfg.hungerDecayPerHour);
  let cleanliness = CLAMP(pet.cleanliness - hours * cfg.cleanlinessDecayPerHour);
  let happiness = CLAMP(pet.happiness - hours * cfg.happinessDecayPerHour);
  let health = pet.health;
  let neglectCount = pet.neglectCount;
  let isDead = false;
  let diedAt: Date | null = null;
  let stage = pet.stage as PetStage;
  let level = pet.level;
  let xp = pet.xp;
  let power = pet.power;
  let stageStartedAt = pet.stageStartedAt;
  let hatchedAt = pet.hatchedAt;

  // Health suffers when any need is critical.
  const critical = [hunger, cleanliness, happiness].filter(v => v <= 15).length;
  if (critical > 0) {
    health = CLAMP(health - hours * (4 + critical * 3));
  } else if (hunger > 50 && cleanliness > 50 && happiness > 50) {
    health = CLAMP(health + hours * 2);
  }

  // A "neglect cycle" fires when health bottoms out from unmet needs.
  if (health <= 0) {
    neglectCount += 1;
    health = 25; // bounce so successive cycles can accumulate
    hunger = Math.max(hunger, 20);
    await logCare(pet.guildId, pet.id, pet.userId, "neglect", { neglectCount });
    if (neglectCount >= cfg.maxNeglects) {
      isDead = true;
      diedAt = new Date();
      health = 0;
    }
  }

  // Growth when healthy enough and enough real time has passed in this stage.
  if (!isDead && stage !== "adult") {
    const stageHours = (now - (stageStartedAt?.getTime() ?? now)) / 3_600_000;
    const healthy = hunger >= 40 && cleanliness >= 40 && happiness >= 40 && health >= 50;
    if (healthy && stageHours >= cfg.growthHours) {
      const idx = PET_STAGES.indexOf(stage);
      if (idx >= 0 && idx < PET_STAGES.length - 1) {
        stage = PET_STAGES[idx + 1]!;
        stageStartedAt = new Date();
        if (stage === "hatchling" && !hatchedAt) hatchedAt = new Date();
        xp += 40;
        level = Math.max(level, 1 + Math.floor(xp / 100));
        power += 8;
        await logCare(pet.guildId, pet.id, pet.userId, "grow", { stage });
      }
    }
  }

  // Soft XP for surviving a day of care.
  if (!isDead && hours >= 1) {
    xp += Math.floor(hours);
    level = Math.max(level, 1 + Math.floor(xp / 100));
    power = Math.max(10, Math.round(
      level * 5
      + (hunger + cleanliness + happiness + health) / 8
      + (PET_STAGES.indexOf(stage) + 1) * 6
      + pet.wins * 3,
    ));
  }

  const [updated] = await db.update(petsTable).set({
    hunger, cleanliness, happiness, health,
    neglectCount, isDead, diedAt: diedAt ?? pet.diedAt,
    stage, level, xp, power,
    stageStartedAt, hatchedAt,
    lastTickAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();

  return updated!;
}

export async function hatchPet(
  guildId: string,
  userId: string,
  opts: { name: string; species: PetSpecies },
): Promise<{ pet: Pet; charged: number }> {
  if (!PET_SPECIES.includes(opts.species)) {
    throw new Error("Invalid species");
  }
  const existing = await getPet(guildId, userId);
  if (existing && !existing.isDead) {
    throw new Error("You already have a living pet. Care for it with /pet.");
  }

  const settings = await getOrCreatePetSettings(guildId);
  if (!settings.enabled) throw new Error("Pets are disabled in this server.");

  let charged = 0;
  if (settings.hatchCost > 0) {
    try {
      charged = await chargeUbCash(guildId, userId, settings.hatchCost, `Hatch pet: ${opts.name}`);
    } catch (err) {
      // Soft-fail economy so a missing UB authorization never blocks the birth ritual.
      // Admins can still require spend once the app is authorized.
      const msg = err instanceof Error ? err.message : String(err);
      if (/not authorized|UNBELIEVABOAT_TOKEN|rate limit|503/i.test(msg)) {
        charged = 0;
      } else if (/Not enough UnbelievaBoat cash/i.test(msg)) {
        throw err;
      } else {
        charged = 0;
      }
    }
  }

  const variant = Math.floor(Math.random() * 4);
  // Birth ritual: the hatch GIF shows egg→crack→baby; the stored pet starts
  // as a hatchling so the player immediately has something to care for
  // (classic Connection still has a short egg, but Discord needs a clear payoff).
  const values = {
    guildId,
    userId,
    name: opts.name.slice(0, 24),
    species: opts.species,
    variant,
    stage: "hatchling" as const,
    hunger: 85,
    cleanliness: 90,
    happiness: 90,
    health: 100,
    level: 1,
    xp: 10,
    power: 12,
    neglectCount: 0,
    isDead: false,
    diedAt: null,
    inventory: { food: 2, soap: 1 } as Record<string, number>,
    cosmetics: [] as string[],
    lastTickAt: new Date(),
    stageStartedAt: new Date(),
    hatchedAt: new Date(),
  };

  let pet: Pet;
  if (existing?.isDead) {
    const [row] = await db.update(petsTable).set({
      ...values,
      wins: 0,
      losses: 0,
      activeCosmetic: null,
      updatedAt: new Date(),
    }).where(eq(petsTable.id, existing.id)).returning();
    pet = row!;
  } else {
    const [row] = await db.insert(petsTable).values(values).returning();
    pet = row!;
  }

  await logCare(guildId, pet.id, userId, "hatch", { species: opts.species, charged });
  return { pet, charged };
}

async function chargeUbCash(guildId: string, userId: string, amount: number, reason: string): Promise<number> {
  if (amount <= 0) return 0;
  const ub = await getOrCreateUbSettings(guildId);
  if (!ub.petsSpendUb || !isUbConfigured()) {
    // Soft mode: allow free play until Railway token is plugged in.
    return 0;
  }
  const bal = await ubApi.getUserBalance(ub.ubGuildId, userId);
  if ((bal.cash ?? 0) < amount) {
    throw new Error(`Not enough UnbelievaBoat cash. Need ${amount}, have ${bal.cash ?? 0}.`);
  }
  await ubApi.patchUserBalance(ub.ubGuildId, userId, { cash: -amount, reason });
  return amount;
}

export async function feedPet(pet: Pet, itemKey = "food"): Promise<Pet> {
  if (pet.isDead) throw new Error("This pet has passed on.");
  const inv = { ...(pet.inventory ?? {}) };
  if ((inv[itemKey] ?? 0) > 0) {
    inv[itemKey] = (inv[itemKey] ?? 0) - 1;
  }
  const boost = itemKey === "feast" ? 45 : 28;
  const [updated] = await db.update(petsTable).set({
    hunger: CLAMP(pet.hunger + boost),
    happiness: CLAMP(pet.happiness + 8),
    health: CLAMP(pet.health + 4),
    inventory: inv,
    lastFedAt: new Date(),
    xp: pet.xp + 5,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();
  await logCare(pet.guildId, pet.id, pet.userId, "feed", { itemKey, boost });
  return tickPet(updated!);
}

export async function cleanPet(pet: Pet): Promise<Pet> {
  if (pet.isDead) throw new Error("This pet has passed on.");
  const [updated] = await db.update(petsTable).set({
    cleanliness: CLAMP(pet.cleanliness + 35),
    happiness: CLAMP(pet.happiness + 6),
    lastCleanedAt: new Date(),
    xp: pet.xp + 5,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();
  await logCare(pet.guildId, pet.id, pet.userId, "clean", {});
  return tickPet(updated!);
}

export async function playWithPet(pet: Pet): Promise<Pet> {
  if (pet.isDead) throw new Error("This pet has passed on.");
  const [updated] = await db.update(petsTable).set({
    happiness: CLAMP(pet.happiness + 32),
    hunger: CLAMP(pet.hunger - 6),
    cleanliness: CLAMP(pet.cleanliness - 4),
    lastPlayedAt: new Date(),
    xp: pet.xp + 8,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();
  await logCare(pet.guildId, pet.id, pet.userId, "play", {});
  return tickPet(updated!);
}

export async function buyPetItem(
  guildId: string,
  userId: string,
  item: { key: string; price: number; label: string },
): Promise<{ pet: Pet; charged: number }> {
  let pet = await getPet(guildId, userId);
  if (!pet || pet.isDead) throw new Error("Hatch a living pet first with /pet hatch.");
  pet = await tickPet(pet);

  const charged = await chargeUbCash(guildId, userId, item.price, `Pet shop: ${item.label}`);
  const inv = { ...(pet.inventory ?? {}) };
  inv[item.key] = (inv[item.key] ?? 0) + 1;

  const [updated] = await db.update(petsTable).set({
    inventory: inv,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, pet.id)).returning();

  await logCare(guildId, pet.id, userId, "buy", { item: item.key, charged });
  return { pet: updated!, charged };
}

export async function usePetItem(pet: Pet, key: string): Promise<Pet> {
  if (pet.isDead) throw new Error("This pet has passed on.");
  const inv = { ...(pet.inventory ?? {}) };
  if ((inv[key] ?? 0) <= 0) throw new Error(`You don't have any ${key}.`);
  inv[key] = (inv[key] ?? 0) - 1;

  let patch: Partial<Pet> = { inventory: inv, updatedAt: new Date() };
  if (key === "food" || key === "feast") {
    return feedPet({ ...pet, inventory: { ...inv, [key]: (inv[key] ?? 0) + 1 } }, key);
  }
  if (key === "soap") {
    patch = {
      ...patch,
      cleanliness: CLAMP(pet.cleanliness + 40),
      happiness: CLAMP(pet.happiness + 5),
      lastCleanedAt: new Date(),
    };
  } else if (key === "toy") {
    patch = {
      ...patch,
      happiness: CLAMP(pet.happiness + 40),
      lastPlayedAt: new Date(),
    };
  } else if (key === "medicine") {
    patch = {
      ...patch,
      health: CLAMP(pet.health + 35),
      neglectCount: Math.max(0, pet.neglectCount - 1),
    };
  } else if (key === "ribbon" || key === "hat" || key === "armor") {
    const cosmetics = Array.from(new Set([...(pet.cosmetics ?? []), key]));
    patch = { ...patch, cosmetics, activeCosmetic: key };
  }

  const [updated] = await db.update(petsTable).set(patch as never).where(eq(petsTable.id, pet.id)).returning();
  await logCare(pet.guildId, pet.id, pet.userId, "use", { key });
  return tickPet(updated!);
}

export function moodOf(pet: Pet): "ecstatic" | "happy" | "ok" | "sad" | "critical" | "dead" {
  if (pet.isDead) return "dead";
  const avg = (pet.hunger + pet.cleanliness + pet.happiness + pet.health) / 4;
  if (avg >= 85) return "ecstatic";
  if (avg >= 65) return "happy";
  if (avg >= 40) return "ok";
  if (avg >= 20) return "sad";
  return "critical";
}

export function isDirty(pet: Pet): boolean {
  return pet.cleanliness < 35;
}

export function isHungry(pet: Pet): boolean {
  return pet.hunger < 35;
}

export async function createChallenge(
  guildId: string,
  challengerId: string,
  opponentId: string,
  wager: number,
): Promise<{ id: number }> {
  if (challengerId === opponentId) throw new Error("You can't challenge yourself.");
  const a = await getPet(guildId, challengerId);
  const b = await getPet(guildId, opponentId);
  if (!a || a.isDead) throw new Error("You need a living pet to challenge.");
  if (!b || b.isDead) throw new Error("That member doesn't have a living pet.");

  const [row] = await db.insert(petChallengesTable).values({
    guildId,
    challengerId,
    opponentId,
    wager: Math.max(0, wager),
    status: "pending",
  }).returning({ id: petChallengesTable.id });
  return { id: row!.id };
}

export async function resolveChallenge(challengeId: number, acceptorId: string): Promise<{
  challenge: typeof petChallengesTable.$inferSelect;
  winner: Pet;
  loser: Pet;
}> {
  const rows = await db.select().from(petChallengesTable).where(eq(petChallengesTable.id, challengeId)).limit(1);
  const ch = rows[0];
  if (!ch) throw new Error("Challenge not found.");
  if (ch.status !== "pending") throw new Error("Challenge already resolved.");
  if (ch.opponentId !== acceptorId) throw new Error("This challenge isn't for you.");

  let a = await getPet(ch.guildId, ch.challengerId);
  let b = await getPet(ch.guildId, ch.opponentId);
  if (!a || !b || a.isDead || b.isDead) throw new Error("Both pets must be alive.");
  a = await tickPet(a);
  b = await tickPet(b);

  // Weighted roll by power + care quality.
  const score = (p: Pet) =>
    p.power * 1.2
    + (p.hunger + p.cleanliness + p.happiness + p.health) / 4
    + Math.random() * 40;

  const sa = score(a);
  const sb = score(b);
  const aWins = sa >= sb;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;

  // Optional UB wager transfer.
  if (ch.wager > 0 && isUbConfigured()) {
    try {
      const ub = await getOrCreateUbSettings(ch.guildId);
      if (ub.petsSpendUb) {
        await ubApi.patchUserBalance(ub.ubGuildId, loser.userId, {
          cash: -ch.wager,
          reason: `Pet challenge loss vs ${winner.name}`,
        });
        await ubApi.patchUserBalance(ub.ubGuildId, winner.userId, {
          cash: ch.wager,
          reason: `Pet challenge win vs ${loser.name}`,
        });
      }
    } catch {
      // Don't fail the fight if economy is unreachable — still record the duel.
    }
  }

  const [wUp] = await db.update(petsTable).set({
    wins: winner.wins + 1,
    xp: winner.xp + 25,
    happiness: CLAMP(winner.happiness + 10),
    power: winner.power + 2,
    updatedAt: new Date(),
  }).where(eq(petsTable.id, winner.id)).returning();

  const [lUp] = await db.update(petsTable).set({
    losses: loser.losses + 1,
    happiness: CLAMP(loser.happiness - 8),
    updatedAt: new Date(),
  }).where(eq(petsTable.id, loser.id)).returning();

  const [updated] = await db.update(petChallengesTable).set({
    status: "done",
    winnerId: winner.userId,
    result: { sa, sb, winnerPetId: winner.id, loserPetId: loser.id },
    resolvedAt: new Date(),
  }).where(eq(petChallengesTable.id, challengeId)).returning();

  return { challenge: updated!, winner: wUp!, loser: lUp! };
}

export async function cancelChallenge(challengeId: number, userId: string): Promise<void> {
  const rows = await db.select().from(petChallengesTable).where(eq(petChallengesTable.id, challengeId)).limit(1);
  const ch = rows[0];
  if (!ch || ch.status !== "pending") return;
  if (ch.challengerId !== userId && ch.opponentId !== userId) throw new Error("Not your challenge.");
  await db.update(petChallengesTable).set({ status: "cancelled" }).where(eq(petChallengesTable.id, challengeId));
}

export async function petLeaderboard(guildId: string, limit = 15) {
  return db.select({
    userId: petsTable.userId,
    name: petsTable.name,
    species: petsTable.species,
    stage: petsTable.stage,
    level: petsTable.level,
    power: petsTable.power,
    wins: petsTable.wins,
    losses: petsTable.losses,
  }).from(petsTable)
    .where(and(eq(petsTable.guildId, guildId), eq(petsTable.isDead, false)))
    .orderBy(desc(petsTable.power), desc(petsTable.wins))
    .limit(limit);
}

export const DEFAULT_SHOP: { key: string; label: string; price: number; emoji: string; blurb: string }[] = [
  { key: "food", label: "Pet Food", price: 40, emoji: "🍖", blurb: "Fills hunger (+28)" },
  { key: "feast", label: "Feast Bowl", price: 90, emoji: "🍗", blurb: "Big meal (+45 hunger)" },
  { key: "soap", label: "Bubble Soap", price: 35, emoji: "🧼", blurb: "Deep clean (+40)" },
  { key: "toy", label: "Squeaky Toy", price: 50, emoji: "🧸", blurb: "Playtime happiness (+40)" },
  { key: "medicine", label: "Care Kit", price: 120, emoji: "💊", blurb: "Restore health, ease neglect" },
  { key: "ribbon", label: "Fancy Ribbon", price: 200, emoji: "🎀", blurb: "Cosmetic flair" },
  { key: "hat", label: "Tiny Hat", price: 250, emoji: "🎩", blurb: "Cosmetic flair" },
  { key: "armor", label: "Battle Scale", price: 400, emoji: "🛡️", blurb: "Cosmetic + swagger" },
];

export function stageLabel(stage: string): string {
  switch (stage) {
    case "egg": return "Egg";
    case "hatchling": return "Hatchling";
    case "juvenile": return "Juvenile";
    case "adult": return "Adult";
    default: return stage;
  }
}

export { PET_SPECIES, PET_STAGES };
export type { PetSpecies, PetStage };

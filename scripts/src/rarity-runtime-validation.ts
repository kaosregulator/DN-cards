import assert from "node:assert/strict";
type RarityContext = {
  guildId: string;
  profile: Map<string, any>;
  customByCard: Map<number, any>;
  customBySlug: Map<string, any>;
  customs: any[];
};

const runtimeModulePath = "../../artifacts/api-server/src/bot/rarity-runtime.js";
const {
  buildDropChanceSummary,
  getEffectiveDropWeight,
  getGuildRarityWeights,
} = await import(runtimeModulePath) as any;

const guildSettings = {
  rarityWeightCommon: 10,
  rarityWeightUncommon: null,
  rarityWeightRare: null,
  rarityWeightEpic: null,
  rarityWeightLegendary: null,
  rarityWeightMythic: null,
} as any;

const prismatic = {
  slug: "prismatic",
  name: "Prismatic",
  emoji: "✨",
  color: 0xffffff,
  position: 6.5,
  worthValue: 9000,
  burnValue: 4500,
  dropWeight: 20,
  droppable: true,
} as any;

const disabledCustom = {
  ...prismatic,
  slug: "disabled",
  name: "Disabled",
  dropWeight: 99,
  droppable: false,
} as any;

const ctx: RarityContext = {
  guildId: "guild-a",
  profile: new Map([["common", { dropWeight: 30 } as any]]),
  customByCard: new Map([[2, prismatic], [4, disabledCustom]]),
  customBySlug: new Map([["prismatic", prismatic], ["disabled", disabledCustom]]),
  customs: [prismatic, disabledCustom],
};

const cards = [
  { id: 1, rarity: "common", worthValue: 10, burnValue: 5, dropWeight: 60, droppable: true, isArchived: false },
  { id: 2, rarity: "rare", worthValue: 200, burnValue: 100, dropWeight: 1, droppable: true, isArchived: false },
  { id: 3, rarity: "uncommon", worthValue: 50, burnValue: 25, dropWeight: 25, droppable: false, isArchived: false },
  { id: 4, rarity: "legendary", worthValue: 2500, burnValue: 1250, dropWeight: 4, droppable: true, isArchived: false },
];

const rarityWeights = getGuildRarityWeights(guildSettings);
assert.deepEqual(rarityWeights?.common, 10, "legacy guild weights should be available when configured");

assert.equal(
  getEffectiveDropWeight(cards[0]!, { ctx, rarityWeights, setRarityWeights: { common: 40 } }),
  40,
  "active set rarity override should beat profile and legacy guild weights",
);
assert.equal(
  getEffectiveDropWeight(cards[0]!, { ctx, rarityWeights }),
  30,
  "rarity profile should beat legacy guild weight when no set override exists",
);
assert.equal(
  getEffectiveDropWeight(cards[2]!, { ctx, rarityWeights }),
  25,
  "card baseline remains fallback for rarities without profile or legacy override",
);
assert.equal(
  getEffectiveDropWeight(cards[1]!, { ctx, rarityWeights, setRarityWeights: { rare: 80 }, eventBoosts: new Map([[2, 2]]) }),
  40,
  "custom tier drop weight should replace other sources, then event boost should multiply it",
);

const summary = buildDropChanceSummary(cards, {
  ctx,
  rarityWeights,
  setRarityWeights: { common: 40 },
  eventBoosts: new Map([[2, 2]]),
});

assert.equal(summary.weightByCardId.get(1), 40);
assert.equal(summary.weightByCardId.get(2), 40);
assert.equal(summary.weightByCardId.has(3), false, "non-droppable cards should not count toward spawn percentages");
assert.equal(summary.weightByCardId.has(4), false, "non-droppable custom tiers should exclude assigned cards");
assert.equal(summary.rarityPercentByKey.get("common"), 50);
assert.equal(summary.rarityPercentByKey.get("custom:prismatic"), 50);
assert.equal(Math.round([...summary.cardPercentById.values()].reduce((sum, pct) => sum + pct, 0)), 100);

console.log("rarity runtime validation passed");

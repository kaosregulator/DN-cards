// Routes /daily_ub, /slots_ub, … to existing UnbelievaBoat handlers.

import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

export async function handleUbSlashCommand(
  interaction: ChatInputCommandInteraction,
  cmd: string,
): Promise<void> {
  switch (cmd) {
    case "daily_ub": {
      const { handleAnimatedDaily } = await import("./casino.js");
      await handleAnimatedDaily(interaction);
      return;
    }
    case "collect_ub": {
      const { handleCollect } = await import("./casino.js");
      await handleCollect(interaction);
      return;
    }
    case "bal_ub": {
      const { handleBalance } = await import("./casino.js");
      await handleBalance(interaction);
      return;
    }
    case "deposit_ub": {
      const { handleDeposit } = await import("./casino.js");
      await handleDeposit(interaction);
      return;
    }
    case "withdraw_ub": {
      const { handleWithdraw } = await import("./casino.js");
      await handleWithdraw(interaction);
      return;
    }
    case "top_ub": {
      const { handleCasinoTop } = await import("./casino.js");
      await handleCasinoTop(interaction);
      return;
    }
    case "slots_ub": {
      const { handleSlots } = await import("./live-slots.js");
      await handleSlots(interaction);
      return;
    }
    case "blackjack_ub": {
      const { handleBlackjack } = await import("./games.js");
      await handleBlackjack(interaction);
      return;
    }
    case "roulette_ub": {
      const { handleRoulette } = await import("./live-roulette.js");
      await handleRoulette(interaction);
      return;
    }
    case "uno_ub": {
      const { handleUno } = await import("./uno.js");
      await handleUno(interaction);
      return;
    }
    case "higherlower_ub": {
      const { handleHigherLower } = await import("./games.js");
      await handleHigherLower(interaction);
      return;
    }
    case "redblack_ub": {
      const { handleRedBlack } = await import("./games.js");
      await handleRedBlack(interaction);
      return;
    }
    case "work_ub": {
      const { handleCashWork } = await import("./games.js");
      await handleCashWork(interaction);
      return;
    }
    case "crime_ub": {
      const { handleCashCrime } = await import("./games.js");
      await handleCashCrime(interaction);
      return;
    }
    case "beg_ub": {
      const { handleSlut } = await import("./games.js");
      await handleSlut(interaction);
      return;
    }
    case "rob_ub": {
      const { handleRob } = await import("./games.js");
      await handleRob(interaction);
      return;
    }
    case "russian_ub": {
      const { handleRussian } = await import("./russian-duel.js");
      await handleRussian(interaction);
      return;
    }
    case "store_ub": {
      const { handleCashStore } = await import("./store.js");
      await handleCashStore(interaction);
      return;
    }
    default:
      await interaction.reply({ content: `Unknown UB command: \`/${cmd}\``, ...EPHEMERAL }).catch(() => {});
  }
}

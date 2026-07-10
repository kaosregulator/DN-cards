// ─────────────────────────────────────────────────────────────────────────────
// Bob add-on — single entry point. Drop the `bob/` folder in, then wire Bob into
// your bot with just TWO lines (plus one optional line for random events):
//
//   1) Command registration — add Bob's commands to the array you REST.put():
//        const commands = [ ...yourCommands, ...bobCommandsJson() ];
//
//   2) Interaction handling — at the TOP of your InteractionCreate handler:
//        if (await routeBobInteraction(interaction)) return;
//
//   3) (optional) Random channel events — in your ClientReady handler:
//        startBobEvents(client);
//
// Everything else (buttons, selects, modals, cooldowns, economy) is self-
// contained inside this folder.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder, PermissionFlagsBits, type Interaction,
} from "discord.js";
import {
  handleBob, handleBobRoulette, handleBobDuel, handleBobRoast, handleBobTalk,
  handleBobStats, handleBobLeaderboard,
} from "./command.js";
import { handleBobAdmin } from "./admin.js";
import {
  handleBobButton, handleBobSelect, handleBobUserSelect, handleBobModal,
} from "./router.js";

export { startBobEvents } from "./events.js";
// Optional: call from your MessageCreate handler so Bob occasionally reacts to
// @mentions:  void handleBobMention(msg);
export { handleBobMention } from "./talk.js";

// Build Bob's 8 slash commands as JSON, ready to spread into your command array.
export function bobCommandsJson() {
  const cmd = (name: string, desc: string, build?: (s: SlashCommandBuilder) => unknown) => {
    const b = new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false);
    build?.(b);
    return b.toJSON();
  };
  const admin = (name: string, desc: string, build: (s: SlashCommandBuilder) => unknown) => {
    const b = new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false)
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    build(b);
    return b.toJSON();
  };

  return [
    cmd("bob", "(User) Open Bob — games, roasts, tasks, quests & chaos"),
    cmd("bob_roulette", "(User) Play Bob's roulette — survive the chamber for coins"),
    cmd("bob_duel", "(User) Challenge someone to a Bob roulette duel", s =>
      s.addUserOption(o => o.setName("user").setDescription("Who to duel").setRequired(true))),
    cmd("bob_roast", "(User) Have Bob roast a member", s =>
      s.addUserOption(o => o.setName("user").setDescription("Who to roast").setRequired(true))),
    cmd("bob_talk", "(User) Chat with Bob", s =>
      s.addStringOption(o => o.setName("message").setDescription("Say something to Bob (leave empty to open the chat)"))),
    cmd("bob_stats", "(User) View your (or someone's) Bob stats", s =>
      s.addUserOption(o => o.setName("user").setDescription("Whose stats (default: you)"))),
    cmd("bob_leaderboard", "(User) Bob leaderboards — coins, wins, streaks & more", s =>
      s.addStringOption(o => o.setName("board").setDescription("Which leaderboard").addChoices(
        { name: "🪙 Richest", value: "coins" }, { name: "🏆 Most wins", value: "wins" },
        { name: "🎲 Best roulette streak", value: "streak" }, { name: "💬 Most interactions", value: "interactions" },
        { name: "🎰 Biggest gamblers", value: "gambled" }, { name: "💎 Jackpot kings", value: "jackpots" },
        { name: "📈 Highest level", value: "level" }))),
    admin("bob_admin", "(Admin) Configure Bob — toggles, odds, rewards, cooldown, channels, avatars", s => s
      .addSubcommand(sc => sc.setName("settings").setDescription("View Bob's current settings"))
      .addSubcommand(sc => sc.setName("toggle").setDescription("Enable/disable Bob or a game/feature")
        .addStringOption(o => o.setName("feature").setDescription("bob, events, ai, dex, roulette, roast, duel, coinflip, dice, hl, slots, wheel, emoji").setRequired(true))
        .addBooleanOption(o => o.setName("enabled").setDescription("On or off").setRequired(true)))
      .addSubcommand(sc => sc.setName("odds").setDescription("Set Blue / Upside-Down appearance chances")
        .addIntegerOption(o => o.setName("blue").setDescription("Blue Bob % (0-100)").setMinValue(0).setMaxValue(100))
        .addIntegerOption(o => o.setName("upside").setDescription("Upside-Down Bob % (0-100)").setMinValue(0).setMaxValue(100)))
      .addSubcommand(sc => sc.setName("rewards").setDescription("Set the reward multiplier %")
        .addIntegerOption(o => o.setName("multiplier").setDescription("Percent (100 = normal)").setRequired(true).setMinValue(0).setMaxValue(1000)))
      .addSubcommand(sc => sc.setName("cooldown").setDescription("Set the per-user action cooldown")
        .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0-120)").setRequired(true).setMinValue(0).setMaxValue(120)))
      .addSubcommand(sc => sc.setName("channels").setDescription("Manage channels Bob can appear in for random events")
        .addStringOption(o => o.setName("action").setDescription("add / remove / clear").setRequired(true)
          .addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }, { name: "clear", value: "clear" }))
        .addChannelOption(o => o.setName("channel").setDescription("Channel to add/remove")))
      .addSubcommand(sc => sc.setName("testevent").setDescription("Spawn a Bob event now (test)")
        .addChannelOption(o => o.setName("channel").setDescription("Where (default: here)")))
      .addSubcommand(sc => sc.setName("image").setDescription("Set a scene/reaction image (win, lose, suspense, jackpot, roulette, blackjack, event)")
        .addStringOption(o => o.setName("key").setDescription("Which image slot").setRequired(true)
          .addChoices({ name: "win", value: "win" }, { name: "lose", value: "lose" }, { name: "suspense", value: "suspense" },
            { name: "jackpot", value: "jackpot" }, { name: "roulette", value: "roulette" }, { name: "blackjack", value: "blackjack" }, { name: "event", value: "event" }))
        .addStringOption(o => o.setName("url").setDescription("Direct image/GIF URL — empty to clear")))
      .addSubcommand(sc => sc.setName("avatar").setDescription("Set Bob's avatar image per form")
        .addStringOption(o => o.setName("form").setDescription("Which Bob").setRequired(true)
          .addChoices({ name: "🟡 Normal Bob", value: "normal" }, { name: "🔵 Blue Bob", value: "blue" }, { name: "🙃 Upside-Down Bob", value: "upside" }))
        .addStringOption(o => o.setName("url").setDescription("Direct image URL (.png/.jpg/.gif/.webp) — empty to clear")))),
  ];
}

// Route any Bob interaction. Returns true if it was a Bob interaction (so your
// handler can `return` early); false to let your other handlers run.
export async function routeBobInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case "bob": await handleBob(interaction); return true;
      case "bob_roulette": await handleBobRoulette(interaction); return true;
      case "bob_duel": await handleBobDuel(interaction); return true;
      case "bob_roast": await handleBobRoast(interaction); return true;
      case "bob_talk": await handleBobTalk(interaction); return true;
      case "bob_stats": await handleBobStats(interaction); return true;
      case "bob_leaderboard": await handleBobLeaderboard(interaction); return true;
      case "bob_admin": await handleBobAdmin(interaction); return true;
      default: return false;
    }
  }
  if (interaction.isButton() && interaction.customId.startsWith("bob:")) { await handleBobButton(interaction); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("bob:")) { await handleBobSelect(interaction); return true; }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("bob:")) { await handleBobUserSelect(interaction); return true; }
  if (interaction.isModalSubmit() && interaction.customId.startsWith("bob:")) { await handleBobModal(interaction); return true; }
  return false;
}

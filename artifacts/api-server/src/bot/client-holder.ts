import type { Client } from "discord.js";

// Tiny singleton so non-bot code (HTTP routes) can ask the bot client for
// state like the guild list. The bot writes here once on startup; everyone
// else reads. Returns null until startBot() has wired it up.
let client: Client | null = null;

export function setBotClient(c: Client): void {
  client = c;
}

export function getBotClient(): Client | null {
  return client;
}

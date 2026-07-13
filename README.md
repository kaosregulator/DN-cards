# DN Cards

🎴 **DarkNight's collectible military trading card game for Discord & Roblox communities**

A fully-featured Discord bot for collecting, trading, and battling with military-themed cards. Features random spawns, pack stores, daily rewards, trading systems, achievements, and more.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord)](https://discord.js.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Features

### 🎮 Core Gameplay
- **Random Card Spawns** — Cards appear at configured intervals in spawn channels
- **Card Packs** — Purchase packs with in-game currency (Basic/Premium/Legendary tiers)
- **Daily Rewards** — Claim daily shards with streak bonuses (up to 7 days)
- **Trading System** — Propose and accept trades with fairness warnings
- **Trade-In System** — Burn 5 cards of one rarity for 1 of the next tier
- **Wishlist** — Get notified when your wishlist cards spawn
- **Limited Events** — Admin-controlled spawn boosts for special cards

### 🏆 Progression
- **9 Collector Ranks** — Recruit → Dark Commander (based on unique cards owned)
- **10 Achievements** — Unlock achievements for various milestones
- **Leaderboards** — Top 10 net-worth rankings and stats
- **Shiny Cards** — 0.5% chance on any acquisition (2× worth/burn value)
- **Limited Editions** — Admin-created cards with copy caps
- **Event Exclusive Cards** — Admin-drop only, never in random draws

### ⚙️ Admin Tools
- **Visual Config Panel** (`/config`) — Toggles, intervals, rates, pack settings
- **Embed Customization** — Rebrand all bot embeds per server
- **Custom Rarity Tiers** — Create new rarity levels beyond the 6 built-ins
- **Per-Server Rarity Weights** — Override worth/burn/drop-weight per rarity
- **Card Sets** — Manage spawn rotation and active card pools
- **Giveaway System** — Run giveaways with custom prizes and entry requirements
- **Interactive Setup Wizard** — `!setup` for guided first-time configuration

### 🎨 Entertainment (Bob)
- **Minigames** — Roulette, Duel, Coin Flip, Dice, Slots, and more
- **Roasts & AI Talk** — Claude-powered conversations (optional)
- **Levels & Cosmetics** — Independent progression with titles and rewards
- **Leaderboards** — Richest players, best streaks, jackpot kings

---

## Quick Start

### Prerequisites
- **Node.js 24+**
- **PostgreSQL** database
- **Discord bot token** with `MESSAGE_CONTENT` and `SERVER MEMBERS` intents enabled

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
export DATABASE_URL="postgresql://user:password@localhost/dn_cards"
export DISCORD_BOT_TOKEN="your_bot_token_here"

# Apply database schema
pnpm --filter @workspace/db run push

# Run the API server + Discord bot
pnpm --filter @workspace/api-server run dev
```

The bot will start on **port 5000** with the API and Discord connection active.

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:password@host:5432/database
DISCORD_BOT_TOKEN=your_bot_token

# Optional
NODE_ENV=development
ANTHROPIC_API_KEY=for_claude_ai_features  # optional, enables /bob_talk AI
```

---

## Tech Stack

- **Runtime:** Node.js 24, TypeScript 5.9
- **API:** Express 5
- **Database:** PostgreSQL + Drizzle ORM
- **Discord:** discord.js v14
- **Validation:** Zod v4, drizzle-zod
- **Build:** esbuild (CJS bundle)
- **Package Manager:** pnpm workspaces

---

## Project Structure

```
DN-cards/
├── artifacts/
│   ├── api-server/          # Express + Discord bot
│   └── dashboard/           # Admin web interface
├── lib/
│   ├── db/                  # Drizzle schema & migrations
│   └── api-spec/            # OpenAPI contract
└── scripts/                 # Utility scripts & validation
```

---

## Core Commands

### User Commands
| Command | Description |
|---------|-------------|
| `/collection` | View your card collection with rank & net worth |
| `/daily` | Claim daily shards (20h cooldown, streak bonus) |
| `/pack` | Open a card pack (Basic/Premium/Legendary) |
| `/burn` | Destroy a card for shards |
| `/trade` | Propose a trade with another member |
| `/wishlist` | Manage cards you want to be notified about |
| `/info` | Card details, worth, burn value, drop chance |
| `/giveaways` | View active giveaways and your progress |
| `/bob` | Open Bob entertainment hub |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/config` | Visual configuration panel |
| `/drop` | Force-drop a specific card |
| `/event start` | Boost a card's spawn weight temporarily |
| `/giveaway_admin` | Create & manage giveaways |
| `/sets_admin` | Manage card sets and spawn rotation |
| `/rarity` | Override rarity tier properties |
| `/embed` | Customize bot embed messages |

### Setup Commands (prefix `!`)
| Command | Description |
|---------|-------------|
| `!setup` | Interactive setup wizard |
| `!addcard` | Add a new card to the pool |
| `!settings` | View current server configuration |

---

## Card System

### Rarities & Values
| Rarity | Worth | Burn | Drop Weight |
|--------|-------|------|-------------|
| Common | 10 💠 | 5 💠 | 60% |
| Uncommon | 50 💠 | 25 💠 | 25% |
| Rare | 200 💠 | 100 💠 | 10% |
| Epic | 800 💠 | 400 💠 | 4% |
| Legendary | 2,500 💠 | 1,250 💠 | 1% |
| Mythic | 6,000 💠 | 3,000 💠 | 0% (admin-only) |

### Card Types
tank · aircraft · ship · vehicle · infantry · boss · community · event · achievement · limited

### Default Cards (27)
**8 Common:** M4 Sherman, Jeep Willys, Dog Tags, M1 Helmet, Radio Set, Supply Truck, Recon Drone, Sandbag Bunker

**6 Uncommon:** M1 Abrams, AH-64 Apache, USS Arleigh Burke, F-16 Fighting Falcon, Bradley IFV, T-80 Objekat

**6 Rare:** F-22 Raptor, USS Nimitz, Leopard 2A7, T-14 Armata, B-2 Spirit, USS Virginia

**4 Epic:** SR-71 Blackbird, USS Gerald R. Ford, F-35 Lightning II, Night Stalker

**3 Legendary:** Darknight Titan, Operation Zero, The Warlord

---

## Economy

**DN Shards (💠)** — the in-game currency

**Earned by:**
- Burning duplicate cards
- Daily rewards (50 base + streak bonus up to +200)
- Gifting/trades
- Achievements
- Admin awards

**Spent on:**
- Pack openings
- Trades
- Gifts

---

## Documentation

**Full feature reference, architecture decisions, and troubleshooting:**

See [`replit.md`](./replit.md) for:
- Complete command reference with all options
- Advanced config (rarity profiles, custom rarities, embeds)
- Card sets and spawn rotation
- Giveaway system details
- Bob entertainment module
- Architecture decisions & gotchas
- Database schema overview

---

## Legal

- **[Terms of Service](./TERMS_OF_SERVICE.md)** — Usage terms and restrictions
- **[Privacy Policy](./PRIVACY_POLICY.md)** — Data collection and handling

---

## Invite the Bot

**OAuth2 Install URL:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Required permissions:
- Send Messages
- Manage Messages (for reactions & updates)
- Embed Links
- Attach Files
- Read Message History
- Moderate Members (for giveaway roles)

---

## Troubleshooting

### Common Issues

**Bot not responding to commands?**
- Ensure `MESSAGE_CONTENT` intent is enabled in Developer Portal
- Check bot has `applications.commands` scope in server invite

**Database connection fails?**
- Verify `DATABASE_URL` environment variable is correct
- Ensure PostgreSQL server is running
- Run `pnpm --filter @workspace/db run push` to apply schema

**Slash commands not appearing?**
- Slash commands are registered globally + per-guild on startup
- Global propagation can take up to 1 hour
- Guild commands should appear instantly

**Images not loading?**
- Card images are added via URL only (no file uploads in prefix commands)
- Use permanent image hosts (Imgur, etc.) — Discord CDN URLs are temporary

---

## Contributing

This is a private project. For issues, feature requests, or contributions, please contact DarkNight or repository maintainers.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Support

- **Documentation:** [`replit.md`](./replit.md)
- **Issues:** [GitHub Issues](https://github.com/kaosregulator/DN-cards/issues)
- **Community:** DarkNight Discord server

---

**Made with ❤️ for the DarkNight community**

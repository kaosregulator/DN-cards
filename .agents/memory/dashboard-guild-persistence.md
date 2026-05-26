---
name: Dashboard active-guild persistence
description: Multi-guild admin dashboards must persist the picker selection, not snap back to guilds[0] on every load.
---

If a dashboard lets one logged-in admin manage multiple Discord guilds, the active `guildId` must survive page reloads — store it in `localStorage` and only auto-pick `guilds[0]` when there is no stored value OR the stored guild is no longer in the live list (bot was kicked).

**Why:** an admin in a newly-joined server kept landing on their original server's data after every refresh, assumed the dashboard "wasn't updating", and reported the leaderboard / cards / collections as broken — when really they were looking at the wrong guild. Searching by guild id manually worked, which is the diagnostic clue.

**How to apply:** any new page that scopes data by `guildId` (embeds, leaderboard, settings, admin tools) must hydrate from the same storage key (`dn:activeGuildId`) and write back on change, so cross-page navigation also preserves the selection. Wrap reads/writes in try/catch — private-mode browsers throw on `localStorage`.

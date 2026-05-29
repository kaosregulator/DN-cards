# Agent Instructions

## Cursor Cloud specific instructions

- See `README.md` and `replit.md` for the standard pnpm workspace commands and product/service overview.
- This setup uses Node 24 via nvm. In Cursor Cloud, `/exec-daemon/node` can appear before nvm on `PATH`; prepend `$HOME/.nvm/versions/node/v24.16.0/bin` (or otherwise verify `node --version` is 24.x) before running pnpm scripts.
- Local development uses Postgres 16 with `DATABASE_URL=postgresql://dn_cards_dev:dn_cards_dev@127.0.0.1:5432/dn_cards_dev`; start the Postgres service if it is not accepting connections, then run the documented Drizzle push command when schema state is stale.
- The API process requires `PORT`. For dashboard/API development without connecting to Discord, set a placeholder `DISCORD_BOT_TOKEN` and leave `FORCE_DISCORD_LOGIN` unset so the bot logs its dev-mode skip. Use a separate real dev bot token plus `FORCE_DISCORD_LOGIN=1` only for Discord gateway E2E testing.
- The dashboard Vite dev server does not proxy `/api/*`; Replit routing handles that in the hosted environment. In Cursor Cloud browser tests, use a one-origin local proxy (or equivalent) that routes `/api` to the API server and all other paths to the dashboard dev server.

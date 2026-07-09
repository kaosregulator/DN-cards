# DN Cards — Echo-Whisper (encrypted messaging addon)

A small, purely-additive addon that layers the standalone **Echo-Whisper** bot's
encrypted-messaging commands directly into the DN Cards bot. Nothing existing is
touched — it only adds its own two per-guild tables and three commands.

## Deployment (one step)

Create the new tables with the existing Drizzle push workflow:

```bash
pnpm --filter @workspace/db push
```

Optionally set `ENCRYPTION_KEY` in the environment. If unset it falls back to the
bot token (stable per deployment) rather than a public default — set an explicit
`ENCRYPTION_KEY` in production so payloads stay readable across a token rotation.

## Commands

- `/whisper user:@member` — opens a modal; posts an encrypted message in the
  channel that only the **sender**, the **recipient**, and (if admin override is
  on) server **admins** can reveal via the **View Whisper** button.
- `/adminsecret` — opens a modal; posts an encrypted staff message that only
  members holding an **authorized viewer role** (or override-admins) can reveal.
- `/echo` (admin) — management hub:
  - `role add|remove|list` — manage the roles allowed to reveal `/adminsecret`.
  - `override enable|disable` — toggle whether admins can decrypt any message.
  - `whisper` / `adminsecret` — view each feature's current configuration.
  - `stats` / `config` — usage stats and configuration overview.

## How it works

- Messages are encrypted with **AES-256-CBC** (key derived from `ENCRYPTION_KEY`).
  Only a short public code (e.g. `WSP-1A2B` / `ECH-1A2B`) is shown in-channel;
  the ciphertext lives in the database and is decrypted server-side only for
  authorized viewers.
- Storage is per-guild in the shared database (`secret_transmissions`,
  `secret_settings`) — replacing the original bot's on-disk JSON files so data
  survives restarts and stays isolated per server.

## Source (`src/bot/secret/`)

| Module | Responsibility |
| --- | --- |
| `crypto` | AES-256-CBC encrypt/decrypt + public transmission codes |
| `db` | Per-guild settings + transmission data-access layer |
| `commands` | `/whisper`, `/adminsecret`, `/echo` slash handlers |
| `interactions` | Modal submits + reveal-button access control |

# Quiet Mode / Quiet Room

Addon feature: a peaceful digital “ghost town” corner inside the server.

> **Disappear without leaving. Return without explaining.**

## Commands

| Command | Who | What |
|---------|-----|------|
| `/quiet` | Members (role-gated if configured) | Enter Quiet Mode. If already quiet, **leave** (emergency exit). |
| `/quiet user:@Member [theme]` | Staff | Place someone into the same Quiet Room experience. No timer. They still click **I'm Ready**. |
| `/quietsetup config\|ensure_room\|status\|audio` | Manage Server / admins | Whitelist/blacklist roles, toggles, room + Quiet role ensure, audio library. |

## What happens on enter

1. State is saved to Postgres **before** permission changes (restart-safe).
2. Bot ensures a shared `#quiet-room` channel (category “Quiet Room”) — **hidden from @everyone**.
3. Bot ensures a **Quiet** quarantine role with **zero base permissions** (never hoist, never mentionable, never special powers), positioned as high as the bot can place it.
4. That role is **denied View** (and talk/connect) on every other category/channel.
5. Quiet Room itself is **view + read only** for Quiet members — no send, react, attach, threads, or voice. The bot posts the card; they press **I'm Ready**.
6. The member receives the Quiet role → sidebar looks like a **one-channel empty server**. Hidden channels can't ping them. Outsiders can't see Quiet Room.
7. Optional voice note from the bot (still no member chat).
8. No public announcement.

### Bot permissions (important)

| Bot perms | What Quiet Mode can do |
|-----------|-------------------------|
| **Administrator** (recommended) | Full empty-server quarantine: create/position Quiet role, hide all other channels, assign/remove role |
| Manage Roles + Manage Channels, bot role **above** Quiet | Same as full quarantine in practice |
| Manage Channels only | Opens Quiet Room + weaker **member** hides; may still leak channels / pings |
| Neither | Can only try to show Quiet Room — **lists channels still visible** in the Heads-up note |

`/quietsetup ensure_room` and `/quietsetup status` spell out whether the bot has Administrator and whether the Quiet role exists.

Discord **Administrator** members still bypass channel hides (platform limit) — UX explains this.

## Audio / voice notes

- **Curated CC0 library** discovered via [Openverse](https://docs.openverse.org/api/reference/search_algorithm.html) (`license=cc0`), harvested into `artifacts/api-server/quiet-audio/sources/` — see `SOURCES.md` + `LICENSE.md`.
- Procedural ffmpeg ambience remains as **fallback** when a curated file is missing.
- Priority at play time: **curated recording → cached prepared mix → procedural**.
- Primary lengths: **3:00** and **5:00** (theme-aware selection, anti-repeat).
- Optional spoken quotes via ffmpeg **flite**, mixed quietly into the ambience (~6–12s in).
- Prefers Discord **native Voice Messages** (`IS_VOICE_MESSAGE` + OGG Opus + waveform) via REST upload; logs success / failure reason / attachment fallback.
- Cache/prebuild pool: `QUIET_AUDIO_CACHE` or `./quiet-audio-cache` — warms curated 3m/5m at bot ready.
- Re-harvest sources: `node artifacts/api-server/scripts/harvest-quiet-audio.mjs`

### Native voice message notes

Discord requires:

- Flag `IS_VOICE_MESSAGE` (`1 << 13`)
- Single audio attachment only (no content/embeds on that message)
- `duration_secs` + base64 `waveform` (≤256 bytes)
- Upload `Content-Type` beginning with `audio/`
- Typical encode: mono Opus in OGG, 48 kHz, ~32 kbps

Bot limitation: some guilds/API paths may reject bot native voice messages; fallback still delivers playable audio. Logs include `Quiet native voice message succeeded`, `… failed — trying attachment fallback`, and `Quiet fallback attachment used`.

## Safety / edge cases

| Case | Behavior |
|------|----------|
| `/quiet` while already quiet | Leaves Quiet Mode (offline exit) |
| Bot restarts mid-quiet | Recovery re-assigns Quiet role + hides + re-posts **I'm Ready** |
| Member leaves server while quiet | State + role/overwrites cleared |
| Double leave / double ready click | Idempotent no-op |
| Administrator users | Discord Admin **bypasses** channel hides — UX explains this |
| Bot missing Admin / Manage Roles | Partial isolation; embed lists channels still visible |
| Many users quiet at once | Shared Quiet role + independent DB rows |

## Files

```
lib/db/src/schema/quiet.ts
artifacts/api-server/quiet-audio/
  LICENSE.md
  SOURCES.md
  sources/…          # harvested CC0 previews
artifacts/api-server/scripts/harvest-quiet-audio.mjs
artifacts/api-server/src/bot/quiet/
  commands.ts
  interactions.ts
  models.ts
  shared.ts
  permissions.ts
  lifecycle.ts
  recovery.ts
  quotes.ts
  audio/
    catalog.ts
    sources.ts
    openverse.ts
    generate.ts
    select.ts
    voice-message.ts
```

## Deploy note

On Railway, Quiet Mode tables are created automatically by `start-production.mjs`
and boot migrations (`CREATE TABLE IF NOT EXISTS quiet_*`, plus
`ALTER TABLE … ADD COLUMN IF NOT EXISTS quiet_role_id`). Existing databases
that already have `guild_settings` do **not** need `AUTO_DB_PUSH=1`.

The Railway image installs **ffmpeg** + **flite** via `nixpacks.toml` so curated
ambience mixes and spoken quotes work in production.

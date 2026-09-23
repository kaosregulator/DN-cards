# Quiet Mode / Quiet Room

Addon feature: a peaceful digital “ghost town” corner inside the server.

> **Disappear without leaving. Return without explaining.**

## Commands

| Command | Who | What |
|---------|-----|------|
| `/quiet` | Members (role-gated if configured) | Enter Quiet Mode. If already quiet, **leave** (emergency exit). |
| `/quiet user:@Member [theme]` | Staff | Place someone into the same Quiet Room experience. No timer. They still click **I'm Ready**. |
| `/quiet_setup config\|ensure_room\|status\|audio` | Manage Server / admins | Whitelist/blacklist roles, toggles, room ensure, audio library. |

## What happens on enter

1. State is saved to Postgres **before** permission changes (restart-safe).
2. Bot ensures a shared `#quiet-room` channel (category “Quiet Room”).
3. **Per-member permission overwrites** hide other categories/channels from that user and allow the Quiet Room.
4. **Roles are never added or removed** — no role audit spam, no tenure/admin role loss.
5. Quiet Room embed + random quote + optional voice note + **🌤️ I'm Ready — Bring Me Back**.
6. No public announcement. Ping attempts against quiet users simply don’t reach channels they can’t see.

## Audio / voice notes

- Built-in catalog under `artifacts/api-server/src/bot/quiet/audio/`.
- Ambience is **procedurally generated** with ffmpeg (original / public domain).
- Spoken quotes use ffmpeg **flite** TTS when available; otherwise ambience-only + quote in the embed.
- Prefers Discord **native Voice Messages** (`IS_VOICE_MESSAGE` + OGG Opus + waveform) via the attachment upload REST flow.
- If native VM creation fails, falls back to a normal playable audio attachment (documented in-channel).
- Cache/prebuild pool: `QUIET_AUDIO_CACHE` or `./quiet-audio-cache` — warm at bot ready.

### Native voice message notes

Discord requires:

- Flag `IS_VOICE_MESSAGE` (`1 << 13`)
- Single audio attachment only (no content/embeds on that message)
- `duration_secs` + base64 `waveform` (≤256 bytes)
- Upload `Content-Type` beginning with `audio/`
- Typical encode: mono Opus in OGG, 48 kHz, ~32 kbps

Bot limitation: some guilds/API paths may reject bot native voice messages; fallback still delivers playable audio.

## Safety / edge cases

| Case | Behavior |
|------|----------|
| `/quiet` while already quiet | Leaves Quiet Mode (offline exit) |
| Bot restarts mid-quiet | Recovery re-applies overwrites + re-posts **I'm Ready** |
| Member leaves server while quiet | State + overwrites cleared |
| Double leave / double ready click | Idempotent no-op |
| Administrator users | Discord Admin **bypasses** channel hides — UX explains this; roles untouched |
| Partial permission failure | `needsRecovery` flag; periodic recovery; `/quiet` still exits |
| Many users quiet at once | Independent DB rows + independent overwrites |

## Files

```
lib/db/src/schema/quiet.ts
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
    generate.ts
    select.ts
    voice-message.ts
```

## External sound sources (for future sample packs)

Current ship uses procedural audio only. Good places for **legally redistributable** ambient samples later:

- [Freesound](https://freesound.org/) — filter **CC0** / **CC-BY** (keep attribution)
- [OpenGameArt](https://opengameart.org/) — CC0 / CC-BY ambience loops
- Pixabay Sound Effects — check current license terms before bundling
- BBC Sound Effects (remArc) — check each clip’s licence

Do **not** pull commercial YouTube music or copyrighted songs into the library.

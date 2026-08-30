# Emoji system

`/emoji` turns any image into an animated Discord emoji. **MakeEmoji.com performs
the generation** — this package drives it and handles everything around it.

```
Discord /emoji
      ↓
  command/          resolve source · defer · reply · control panel
      ↓
  generate.ts       cache → provider → size guard
      ↓
  providers/
    makeemoji/      ┌ api.ts      direct HTTP, if discovery confirmed an endpoint
                    └ browser.ts  headless Chromium driving the real editor
      ↓
  makeemoji.com
      ↓
  GIF / WebP / PNG  →  Discord
```

## Layout

```
emoji/
  index.ts          public surface — import from here, not from subfolders
  generate.ts       the one entry point: cache + provider + upload limits
  types.ts          GenerateOptions / GenerateResult and the local renderer types
  cache/            content-hash keyed, TTL + size bounded
  commands/         /emoji, its control panel, sessions, autocomplete
  providers/
    types.ts        the EmojiProvider interface
    makeemoji/      the real integration (see its README)
    local/          opt-in degraded fallback, OFF by default
  utils/            source fetching + SSRF guard, options, typed errors
  renderer/         the local fallback's procedural renderer
  effects/          the local fallback's effect definitions
  registry/         the local fallback's effect registry
  encoders/         the local fallback's GIF and PNG encoders
```

## Setup

The provider is unconfigured until discovery has run against the live site. Until
then `/emoji` returns a clean error naming what is missing.

```bash
npx playwright install chromium
pnpm makeemoji:discover -- --install
```

Run that from a host with outbound access to makeemoji.com, then commit the
manifest and restart. Full detail — what the report tells you, how to enable the
direct-HTTP path, every environment variable — is in
[`providers/makeemoji/README.md`](./providers/makeemoji/README.md).

## Using it from code

```ts
import { generateEmoji, loadSource } from "../emoji/index.js";

const image = await loadSource(attachment.url);      // fetch + SSRF check + normalise
const { buffer, bytes, providerId, cached } = await generateEmoji({
  image,
  animation: "shake",     // values come from the discovery manifest
  speed: "normal",
  direction: "right",
  size: 128,
  color: "#ff0000",
  quality: "high",
  format: "gif",          // gif | png | webp
});
```

`generateEmoji` throws `EmojiError`, whose `message` is always safe to show a
user and whose `code` identifies the failure — `provider_unavailable`,
`unknown_option`, `site_changed`, `generation_failed`, `rate_limited`,
`browser_failed`, `timeout`, `not_an_image`, `too_large`, `too_big_to_send`.
Anything unexpected becomes `internal` via `toEmojiError`, so a caller never has
to interpret a provider's internals and the bot never crashes because MakeEmoji
had a bad day.

## Options are never invented

The `/emoji` settings are **autocomplete**, not fixed choices. Fixed choices are
baked in when the command is registered with Discord, which would mean shipping a
list of animation names we made up. Autocomplete resolves against the discovery
manifest as the user types, so the menu shows exactly what the site offers and
updates the moment a new manifest is installed. Only `format` is fixed — the
three containers are this integration's own contract.

Values are validated against the manifest again before anything is sent upstream,
so an unknown animation gets a message naming the valid ones rather than a
silently-ignored setting.

## Caching

Identical requests skip the upstream call entirely. The key is the SHA-256 of the
source bytes plus every setting that changes the output — hashing content rather
than a URL means the same avatar hits the same entry whether it arrived as an
attachment, an avatar or a link. Bounded by count (120), total bytes (64 MB) and
age (15 min), because it holds finished image buffers.

## The local fallback

`providers/local/` wraps a procedural renderer that can produce GIF and PNG
without any network. It is **off unless `EMOJI_ALLOW_LOCAL_FALLBACK=1`**, and it
is never reached silently: results are labelled with their provider so a user can
see when they didn't get MakeEmoji's own output, and the log records it. It
refuses WebP and refuses animation names it doesn't have, rather than substituting
something close and calling it the same thing.

It exists so "MakeEmoji is down" and "the bot is broken" stay distinguishable, and
so an operator can choose degraded output over no output. It is not the system.

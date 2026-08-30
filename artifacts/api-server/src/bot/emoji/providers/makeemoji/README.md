# MakeEmoji provider

Generation is performed by **makeemoji.com**. This package drives the real site —
it does not reimplement it.

```
/emoji  →  provider  →  ┌ direct HTTP  (if discovery confirmed an endpoint)
                        └ headless Chromium driving the editor
                              ↓
                        makeemoji.com
                              ↓
                        GIF / WebP / PNG  →  Discord
```

## Why there is a manifest

We do not know MakeEmoji's endpoints, its DOM, or the values its controls accept,
and guessing any of them would produce a provider that sends wrong requests at a
live site and fails in ways nobody can debug.

So every site-specific fact lives in `manifest.json`, which is **produced by
running discovery against the live site**. The code reads it; it never hardcodes
it. The manifest committed here is deliberately empty and `verified: false` —
until you run discovery, the provider reports itself unavailable and `/emoji`
returns a clean error saying so.

## Run discovery

This must run somewhere with outbound access to makeemoji.com. The Claude
development environment is behind an egress proxy that blocks it, so run this on
your laptop, the Replit container, or the bot's server.

```bash
# once, per host
pnpm install
npx playwright install chromium

# investigate
pnpm makeemoji:discover
```

Useful flags:

```bash
pnpm makeemoji:discover -- --headed          # watch it, when a step fails
pnpm makeemoji:discover -- --install         # install the manifest on success
pnpm makeemoji:discover -- --out ./mm        # choose the output directory
pnpm makeemoji:discover -- --timeout 40000   # slower connection
```

It writes:

```
makeemoji-investigation/
  report.md               ← read this first
  manifest.json           ← the file the bot reads
  network.json            every request/response, redacted
  relevant-requests.json  the shortlist that could be the generation call
  inventory.json          every control found, before and after upload
  bundles.json            endpoint strings, encoder signatures, source maps
  responses/              the generated file, if one was retrieved
```

Then install it and restart the bot:

```bash
cp makeemoji-investigation/manifest.json \
   artifacts/api-server/src/bot/emoji/providers/makeemoji/manifest.json
```

Commit that file — it is the integration's configuration.

## What the report answers

- **Is the site reachable** from this host, by plain HTTP *and* by browser? A
  proxy failure looks nothing like a site failure, and the report distinguishes
  them so you don't debug the wrong thing.
- **Where does processing happen?** The bundles are scanned for in-browser
  encoders (gif.js, WebAssembly, WebCodecs, OffscreenCanvas) and for backend
  signatures (real endpoint strings, presigned uploads, job polling). Bare
  `fetch` and `FormData` are explicitly *not* treated as evidence — every modern
  bundle has them, and counting them would produce a confident, wrong answer.
- **Which request generated the emoji?** Every body-carrying request after the
  upload is shortlisted. If the list is empty, that is itself the finding:
  nothing left the page, so generation is client-side and the browser path is
  the integration rather than a fallback.
- **How is the file retrieved?** A download event, a `blob:`/`data:` preview, or
  a URL.
- **What is still missing?** Anything discovery could not establish is listed
  under "Next actions", with the manifest field to fill by hand.

## Direct HTTP vs the browser

The provider prefers `api.ts` when `manifest.api` is set — one request instead of
a Chromium launch. That block is **only ever written from a request that was
actually observed**. There is no fallback endpoint, no "probable" path, and no
guessed parameter naming; with `api` null, the browser path runs.

If the report shortlists a request you can confirm is the generation call, fill
the block in by hand:

```jsonc
"api": {
  "url": "https://…",            // exactly as observed
  "method": "POST",
  "kind": "multipart",           // multipart | json | form
  "imageField": "file",          // the field the image bytes went in
  "fieldMap": { "animation": "anim", "speed": "spd" },
  "staticFields": {},
  "headers": {},                 // non-sensitive only
  "resultPath": "data.url",      // null when the body IS the image
  "requiresBrowserSession": false
}
```

Set `requiresBrowserSession: true` if it needed a cookie or token the browser
established — the provider then skips the direct path rather than fabricating a
credential.

## Configuration

| Variable | Purpose |
|---|---|
| `MAKEEMOJI_MANIFEST_PATH` | Load the manifest from elsewhere, no rebuild needed |
| `MAKEEMOJI_CHROMIUM_PATH` | Pin a Chromium binary |
| `MAKEEMOJI_HEADLESS=0` | Show the browser while debugging |
| `MAKEEMOJI_DEBUG_DIR` | Enable per-request network traces (off by default) |
| `EMOJI_ALLOW_LOCAL_FALLBACK=1` | Permit degraded local rendering when MakeEmoji is down |

Playwright is an **optional** dependency: the bot starts and serves every other
command without it. If its pinned Chromium revision is missing, the runtime
finds an installed build under `PLAYWRIGHT_BROWSERS_PATH` and logs the
substitution rather than failing.

## Safety

- **Redaction is not optional.** Cookies, `authorization`, `x-api-key`, CSRF
  headers and secret-looking query/body parameters are replaced with
  `[redacted]:Nchars` before anything reaches disk — shape preserved, value
  gone. Bodies are truncated so a multipart upload doesn't bury the report.
- **Tracing is off unless `MAKEEMOJI_DEBUG_DIR` is set**, and prunes itself to
  20 files.
- **SSRF.** User-supplied URLs are validated before any fetch: loopback,
  RFC1918, carrier-grade NAT, link-local, multicast, `.internal`/`.local`/
  `.home.arpa`, bare single-label hostnames, and cloud metadata endpoints
  (including `metadata.google.internal` and IPv4-mapped IPv6 spellings like
  `::ffff:169.254.169.254`, which the URL parser normalises to hex).
- **Cleanup.** Every generation closes its context, its browser and its temp
  directory in a `finally` — a leaked Chromium is ~100 MB that never comes back.

## When the site changes

A redesign shows up as `site_changed` errors and a log line naming the selector
that went missing. Re-run discovery and install the new manifest; no code change
should be needed. If discovery itself can no longer find the controls, its report
prints the full inventory so you can correct the manifest by hand.

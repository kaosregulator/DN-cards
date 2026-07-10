---
name: Object storage paths in Discord embeds
description: Discord embed image URLs must be absolute; relative `/objects/...` paths from Replit object storage must be resolved first.
---

# Object storage paths in Discord embeds

## Rule

Whenever a card/boss/avatar image is stored as a Replit object-storage path (`/objects/...`), convert it to an absolute URL with `toAbsoluteImageUrl()` before passing it to any Discord.js embed builder method (`setThumbnail`, `setImage`, etc.).

## Why

Discord.js validates embed image/thumbnail URLs and rejects relative paths. The bot may upload an image successfully to object storage and store the resulting `/objects/uploads/...` path in the database, but then crash when rendering the embed with a `ValidationError: Invalid URL` (or `Expected undefined or null`). The error is silent to the user and shows as Discord's generic "Something went wrong" message.

## How to apply

- Always use `toAbsoluteImageUrl(url)` from `src/bot/image-url.ts` when setting embed images from a card row.
- Existing good examples: `spawn-manager.ts`, `giveaway/embeds.ts`, `user.ts` (card lookup).
- Places that work with card/boss image URLs must be grepped when object storage is introduced for a new feature; the relative path is valid for the website but not for Discord embeds.
- For fields that are not card image URLs (e.g., avatar URLs, Discord attachment URLs), absolute URLs pass through unchanged, so `toAbsoluteImageUrl` is safe to use as a normalizer.
---
name: Bob avatar/emoji consistency
description: How Bob form avatars should interact with the default emoji face in embeds across all UI surfaces.
---

# Bob avatar/emoji consistency

## Rule

When a server admin sets a custom avatar for a Bob form via `/bob_admin avatar`, every Bob embed for that form should:

1. Show the custom image as the embed thumbnail.
2. Use the form name in the title **without** the default emoji face (e.g., `Bob — Coin Flip` instead of `🟡 Bob — Coin Flip`).

When no custom avatar is set, the default behavior remains:

1. No thumbnail.
2. Title starts with the form's emoji face (e.g., `🟡 Bob — Coin Flip`).

## Why

The user expects the avatar to replace the emoji face everywhere. Showing both the yellow circle and the uploaded image at the same time looks broken. This rule gives a single, consistent "avatar or emoji, not both" rule that applies to every `bobEmbed` call.

## How to apply

- `bobEmbed(form, title, description, avatarUrl?)` already accepts the optional avatar URL and uses `formTitle(form, title, avatarUrl)` internally.
- Always pass `formAvatar(settings, form)` (or `bobImage(settings, key, form)`) as the fourth argument when building a Bob embed.
- If you call `formTitle` directly in a footer or description, pass the same `avatarUrl` so the text matches the thumbnail behavior.
- `/bob_admin` settings overview is intentionally exempt — it is an admin-only configuration panel, not a Bob persona surface.
---
name: Bob public game ownership
description: How standalone game commands keep their buttons private to the starting user after switching from ephemeral to public replies.
---

# Bob public game ownership

## Rule

Bob's standalone game slash commands (`/bob_coinflip`, `/bob_dice`, `/bob_hl`, `/bob_slots`, `/bob_wheel`, `/bob_emoji`, `/bob_bj`, `/bob_rps`) post publicly in the channel so everyone can see the game. The button interactions must still be restricted to the user who started the game.

## How to apply

1. Encode the owner's `userId` as the **last segment** of every game button `customId`.
   - `bob:game:<key>:open:<ownerId>`
   - `bob:game:<key>:pick:<data>:<ownerId>`
   - `bob:game:bj:<action>:<encP>:<encD>:<ownerId>`
2. Use the exported `gameId(key, action, ownerId, ...data)` helper in `games.ts` to build IDs consistently.
3. In `handleBobGame`, read `ownerId = parts[parts.length - 1]` and reject the click if it does not match `interaction.user.id`.
4. `navRow({ again: "bob:game:<key>:open", ownerId })` automatically appends the owner to the Play Again button.
5. The `/bob` menu's game list also uses `gameId(k, "open", userId)` so its buttons survive the same ownership check.

## Why

Switching from ephemeral to public replies makes the game visible, but without ownership checks any user could click the buttons and spend the starter's cooldown or steal their rewards. Encoding the owner in the customId keeps the flow stateless and restart-safe.
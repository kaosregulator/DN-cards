# Emoji system

Turns any image into an animated Discord emoji. Entirely local and
self-contained — no third-party service, no sprite-sheet assets, no network
dependency beyond fetching the user's own image.

## Layout

```
emoji/
  index.ts          public surface — import from here, not from subfolders
  types.ts          shared types (EffectDef, Transform, RenderOptions, …)
  registry/         the list of effects; asserts unique ids at load
  effects/          effect definitions, grouped by kind (data, not drawing code)
  renderer/         easing primitives, colourisation, the compositor, orchestration
  encoders/         GIF (animated, transparent) and PNG (still)
  utils/            option vocabulary, source fetching/normalising, typed errors
  commands/         the /emoji slash command, its control panel and session store
```

## How it works

```
attachment / avatar / url
        ↓  utils/source.ts      validate → fetch (bounded) → normalise to RGBA PNG
        ↓  renderer/render.ts   resolve options, enter the shared render queue
        ↓  renderer/compositor  per frame: back layers → subject+transform → front layers
        ↓  encoders/            frames → transparent GIF, or first frame → PNG
   Discord attachment
```

The compositor is the only module that touches a canvas. Effects never draw the
subject themselves — they return a `Transform` describing what should happen to
it on a given frame, and the compositor applies it. That is what keeps effects
pure data and means adding one never requires touching the renderer.

Every value in a `Transform` is resolution-independent: offsets are fractions of
the canvas edge, not pixels. So one definition renders correctly at 32px and at
128px, and `size` is a real parameter rather than a post-hoc resize.

## Adding an effect

Add one entry to the appropriate file in `effects/`. Nothing else needs to
change — the registry, the slash-command choices and the picker UI all derive
from it.

```ts
{
  id: "tilt",                 // stable; never rename in place (customIds use it)
  name: "Tilt",
  emoji: "🙃",
  description: "Leans side to side",
  frames: 12,
  delayMs: 55,
  directional: true,          // false hides the direction control in the UI
  inset: 0.8,                 // resting footprint; leave room for the motion
  transform: ({ t, direction }) => ({ rotate: directionSign(direction) * wave(t) * 0.3 }),
}
```

Build motion from `renderer/easing.ts`. Those helpers are periodic over `t`, so
effects built from them loop seamlessly — a property the test suite enforces.
An effect that is *meant* to jump between frames (like `glitch`) declares
`discontinuous: true` to opt out.

For decoration, add `layers` instead of, or as well as, a transform:

```ts
layers: [{ z: "front", paint: (ctx, { t, size }) => { /* plain canvas drawing */ } }]
```

Painters must be deterministic — seed any randomness from `hashRandom(i)`, never
`Math.random`, so identical options always produce identical bytes.

Two constraints the tests check for you: descriptions stay under 100 characters
(Discord truncates select options), and the registry stays at or under 25 effects
(Discord's cap on slash-command choices). Past 25, switch the `effect` option in
`commands/definition.ts` to autocomplete.

## Using it from code

```ts
import { loadSource, renderEmoji } from "../emoji/index.js";

const image = await loadSource(attachment.url);   // fetch + normalise
const { buffer, bytes } = await renderEmoji(image, {
  effect: "shake", speed: "normal", direction: "right", size: 128, format: "gif",
});
```

`renderEmoji` throws `EmojiError`, whose `message` is always safe to show a user
and whose `code` identifies the failure (`not_an_image`, `too_large`, `timeout`,
`unknown_effect`, …). Anything unexpected is normalised to `internal` by
`toEmojiError`, so a caller never has to guess.

Renders go through the shared `animations/render-queue`, so a burst of `/emoji`
calls can't starve battles or pack openings of CPU.

## Notes

- **GIF transparency** is 1-bit and has no alpha channel, so the encoder picks a
  key colour per image — whichever candidate sits furthest from the colours
  actually present — to stop the background leaking through the subject. PNG
  keeps full 8-bit alpha.
- **Discord's custom-emoji limit is 256 KB.** Output over that is still sent,
  with a note, since it remains a perfectly good GIF for other uses.
- **Sessions** (`commands/session.ts`) hold normalised image bytes so tweaking a
  control re-renders without re-downloading. Bounded by both age and count,
  because it holds image buffers.

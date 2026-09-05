// ─────────────────────────────────────────────────────────────────────────────
// /animate — the command. Owns Discord: resolving the target, deferring,
// rendering candidates, and the interactive panel. All engine work goes through
// the animate index (planner + renderer + detector); this file only orchestrates.
//
// Entry points, matching how index.ts routes interactions:
//   • handleAnimateCommand     — the slash command
//   • handleAnimateInteraction — components / modals whose customId starts `animate:`
// ─────────────────────────────────────────────────────────────────────────────

import {
  AttachmentBuilder, MessageFlags,
  type ChatInputCommandInteraction, type Interaction,
  type MessageComponentInteraction, type ModalSubmitInteraction,
  type StringSelectMenuInteraction, type UserSelectMenuInteraction,
} from "discord.js";
import { logger } from "../../../../lib/logger.js";
import { loadSource } from "../../utils/source.js";
import { EmojiError, toEmojiError } from "../../utils/errors.js";
import type { Intensity, MotionLibrary, Recipe, Region } from "../types.js";
import { INTENSITIES } from "../types.js";
import { loadMotionLibrary } from "../library/motion-library.js";
import { GESTURES, UNIVERSAL_GESTURE } from "../library/gestures.js";
import {
  planCandidates, planFromPicks, buildRecipe, matchGestures,
} from "../planner/planner.js";
import { renderCandidates, renderCandidate } from "../engine/render.js";
import { hashImage } from "../engine/cache.js";
import { detectFeatures } from "../engine/detect.js";
import { renderDebugOverlay, describeMapping } from "../engine/debug.js";
import {
  createSession, getSession, touchSession, endSession, type AnimateSession,
} from "./session.js";
import {
  buildTargetChooser, buildComposeScreen, buildGallery, buildFinishScreen,
  buildPiecePicker, buildDescribeModal, parseCid,
} from "./ui.js";
import { resolveTarget, hasNamedTarget, type Target } from "./target.js";

const OUTPUT_SIZE = 128;
const AVATAR_SIZE = 256;

function speedFactor(_session: AnimateSession): number {
  return 1; // reserved for a future speed control; Normal for now
}

function parseIntensity(raw: string | null | undefined): Intensity {
  return (INTENSITIES as readonly string[]).includes(raw ?? "") ? (raw as Intensity) : "normal";
}

/** Fetch + normalise a target and record its bytes, hash and detected geometry. */
async function loadTarget(session: AnimateSession, target: Target): Promise<void> {
  const image = await loadSource(target.url);
  session.image = image;
  session.imageHash = hashImage(image);
  session.sourceLabel = target.label;
  session.features = await detectFeatures(image);
}

/** Plan candidates from the session's prompt/intensity and render them. */
async function planAndRender(session: AnimateSession): Promise<void> {
  if (!session.image) throw new EmojiError("no_source", "Pick something to animate first.");
  const library = await loadMotionLibrary();
  const recipes = planCandidates({
    prompt: session.prompt, library, intensity: session.intensity, speedFactor: speedFactor(session),
  });
  session.candidates = await renderCandidates(session.image, recipes, session.size, session.features ?? undefined);
  session.selected = null;
  session.view = "gallery";
}

/** Fresh alternate takes for "More takes". */
function planMore(session: AnimateSession, library: MotionLibrary): Recipe[] {
  const t = { intensity: session.intensity, speedFactor: speedFactor(session) };
  const matched = matchGestures(session.prompt);
  if (matched.length > 0) {
    const primary = matched[0]!;
    return [
      buildRecipe(primary, library, t, 2),
      buildRecipe(primary, library, t, 3),
      matched[1] ? buildRecipe(matched[1], library, t, 1) : buildRecipe(UNIVERSAL_GESTURE, library, t, 1),
    ];
  }
  return planCandidates({ prompt: session.prompt, library, intensity: session.intensity, speedFactor: speedFactor(session) });
}

// ── slash command ────────────────────────────────────────────────────────────

export async function handleAnimateCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const intensity = parseIntensity(interaction.options.getString("intensity"));
  const describe = interaction.options.getString("describe")?.trim() ?? "";

  try {
    if (!hasNamedTarget(interaction)) {
      const { token } = createSession({
        image: null, imageHash: null, features: null, ownerId: interaction.user.id,
        sourceLabel: null, prompt: describe, intensity, speed: "normal", size: OUTPUT_SIZE, view: "target",
      });
      await interaction.editReply(buildTargetChooser(token));
      return;
    }

    const target = resolveTarget(interaction);
    const { token, session } = createSession({
      image: null, imageHash: null, features: null, ownerId: interaction.user.id,
      sourceLabel: target.label, prompt: describe, intensity, speed: "normal", size: OUTPUT_SIZE, view: "compose",
    });
    await loadTarget(session, target);

    if (describe) {
      await planAndRender(session);
      await interaction.editReply(buildGallery(session, token));
    } else {
      await interaction.editReply(buildComposeScreen(session, token));
    }
  } catch (err) {
    await interaction.editReply(failure(err) as never);
  }
}

// ── component / modal router ──────────────────────────────────────────────────

export async function handleAnimateInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
  const parsed = parseCid(interaction.customId);
  if (!parsed) return;
  const { action, token, extra } = parsed;

  const session = getSession(token);
  if (!session) {
    await safeReply(interaction, "⌛ This animation panel expired. Run `/animate` again.");
    return;
  }
  if (interaction.user.id !== session.ownerId) {
    await safeReply(interaction, "This isn't your panel — run `/animate` to start your own.");
    return;
  }

  try {
    switch (action) {
      // target selection
      case "pick_user":
        return await onPickUser(interaction as UserSelectMenuInteraction, token, session);
      case "pick_me":
        return await onTarget(interaction as MessageComponentInteraction, token, session, {
          url: interaction.user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE }), label: "your avatar",
        });
      case "pick_server": {
        const url = interaction.guild?.iconURL({ extension: "png", size: AVATAR_SIZE });
        if (!url) return await safeReply(interaction, "This server has no icon set.");
        return await onTarget(interaction as MessageComponentInteraction, token, session, { url, label: "server icon" });
      }
      case "upload":
        return await safeReply(interaction, "Re-run `/animate` and attach your image with the **image** option (uploads can't be added to a button yet).");
      case "target":
        touchSession(token, { view: "target" });
        return await update(interaction as MessageComponentInteraction, buildTargetChooser(token));

      // composing
      case "gesture": {
        const gid = (interaction as StringSelectMenuInteraction).values[0]!;
        const g = GESTURES.find(x => x.id === gid);
        touchSession(token, { prompt: g?.name ?? gid });
        return await renderAndShow(interaction as MessageComponentInteraction, token, session);
      }
      case "intensity": {
        const value = parseIntensity((interaction as StringSelectMenuInteraction).values[0]);
        touchSession(token, { intensity: value });
        if (session.prompt || session.candidates.length) return await renderAndShow(interaction as MessageComponentInteraction, token, session);
        return await update(interaction as MessageComponentInteraction, buildComposeScreen(session, token));
      }
      case "describe":
        return await (interaction as MessageComponentInteraction).showModal(buildDescribeModal(token, session.prompt));
      case "describe_submit": {
        const prompt = (interaction as ModalSubmitInteraction).fields.getTextInputValue("prompt").trim();
        touchSession(token, { prompt });
        return await renderAndShow(interaction as ModalSubmitInteraction, token, session);
      }
      case "more": {
        await (interaction as MessageComponentInteraction).deferUpdate();
        const library = await loadMotionLibrary();
        session.candidates = await renderCandidates(session.image!, planMore(session, library), session.size, session.features ?? undefined);
        session.selected = null; session.view = "gallery";
        return void await interaction.editReply(buildGallery(session, token));
      }

      // choosing / finishing
      case "pick": {
        const idx = Number(extra);
        touchSession(token, { selected: Number.isFinite(idx) ? idx : 0, view: "finish" });
        return await update(interaction as MessageComponentInteraction, buildFinishScreen(session, token));
      }
      case "back":
        touchSession(token, { view: "gallery" });
        return await update(interaction as MessageComponentInteraction, buildGallery(session, token));
      case "compose":
        touchSession(token, { view: "compose" });
        return await update(interaction as MessageComponentInteraction, buildComposeScreen(session, token));
      case "post":
        return await onPost(interaction as MessageComponentInteraction, token, session);
      case "dismiss":
        endSession(token);
        return await update(interaction as MessageComponentInteraction, { content: "🗑️ Dismissed.", files: [], components: [] });

      // debug
      case "debug":
        return await onDebug(interaction as MessageComponentInteraction, token, session);

      // custom pieces
      case "pieces": {
        const library = await loadMotionLibrary();
        touchSession(token, { view: "pieces" });
        return await update(interaction as MessageComponentInteraction, buildPiecePicker(session, token, library));
      }
      case "pick_global": case "pick_eyes": case "pick_mouth": {
        const region = action.replace("pick_", "") as Exclude<Region, "effect">;
        const value = (interaction as StringSelectMenuInteraction).values[0]!;
        const picks = { ...session.picks };
        if (value === "none") delete picks[region]; else picks[region] = value;
        touchSession(token, { picks });
        const library = await loadMotionLibrary();
        return await update(interaction as MessageComponentInteraction, buildPiecePicker(session, token, library));
      }
      case "pick_effect": {
        const values = (interaction as StringSelectMenuInteraction).values.filter(v => v !== "none");
        touchSession(token, { effectPicks: values });
        const library = await loadMotionLibrary();
        return await update(interaction as MessageComponentInteraction, buildPiecePicker(session, token, library));
      }
      case "render_custom":
        return await onRenderCustom(interaction as MessageComponentInteraction, token, session);

      default:
        return;
    }
  } catch (err) {
    await editOrReply(interaction, failure(err));
  }
}

// ── action helpers ─────────────────────────────────────────────────────────

async function onPickUser(interaction: UserSelectMenuInteraction, token: string, session: AnimateSession): Promise<void> {
  const user = interaction.users.first();
  if (!user) return;
  await onTarget(interaction, token, session, {
    url: user.displayAvatarURL({ extension: "png", size: AVATAR_SIZE }), label: `${user.username}'s avatar`,
  });
}

async function onTarget(
  interaction: MessageComponentInteraction, token: string, session: AnimateSession, target: Target,
): Promise<void> {
  await interaction.deferUpdate();
  await loadTarget(session, target);
  session.view = session.prompt ? "gallery" : "compose";
  if (session.prompt) await planAndRender(session);
  await interaction.editReply(session.prompt ? buildGallery(session, token) : buildComposeScreen(session, token));
}

async function renderAndShow(
  interaction: MessageComponentInteraction | ModalSubmitInteraction, token: string, session: AnimateSession,
): Promise<void> {
  await interaction.deferUpdate();
  await planAndRender(session);
  await interaction.editReply(buildGallery(session, token));
}

async function onRenderCustom(interaction: MessageComponentInteraction, token: string, session: AnimateSession): Promise<void> {
  await interaction.deferUpdate();
  if (!session.image) throw new EmojiError("no_source", "Pick something to animate first.");
  const library = await loadMotionLibrary();
  const picks = (Object.entries(session.picks) as [Exclude<Region, "effect">, string][])
    .map(([region, trackId]) => ({ region, trackId }));
  const recipe = planFromPicks(picks, session.effectPicks, library, { intensity: session.intensity, speedFactor: speedFactor(session) }, "Custom");
  const candidate = await renderCandidate({ image: session.image, features: session.features ?? undefined, recipe, size: session.size });
  session.candidates = [candidate];
  session.selected = null;
  session.view = "gallery";
  await interaction.editReply(buildGallery(session, token));
}

async function onDebug(interaction: MessageComponentInteraction, token: string, session: AnimateSession): Promise<void> {
  await interaction.deferUpdate();
  if (!session.image) return;
  const { png, features } = await renderDebugOverlay(session.image, 320);
  const recipe = session.candidates[session.selected ?? 0]?.recipe
    ?? planCandidates({ prompt: session.prompt || "wobble", library: await loadMotionLibrary(), intensity: session.intensity, speedFactor: 1 })[0]!;
  const mapping = describeMapping(recipe, features);
  await interaction.editReply({
    content: ["## 🔍 Detection debug", "```", ...mapping, "```"].join("\n").slice(0, 1900),
    files: [new AttachmentBuilder(png, { name: "detect.png" })],
    components: buildComposeScreen(session, token).components,
  });
}

async function onPost(interaction: MessageComponentInteraction, token: string, session: AnimateSession): Promise<void> {
  const chosen = session.selected != null ? session.candidates[session.selected] : undefined;
  if (!chosen) return await safeReply(interaction, "Pick a take first.");
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || !channel.isTextBased()) {
    return await safeReply(interaction, "I can't post here.");
  }
  await channel.send({
    content: `${interaction.user} animated ${session.sourceLabel ?? "an emoji"}`,
    files: [new AttachmentBuilder(chosen.buffer, { name: "animation.gif" })],
  });
  await interaction.update({ content: "✅ Posted to the channel!", files: [], components: [] });
}

// ── plumbing ─────────────────────────────────────────────────────────────────

interface ViewPayload { content: string; files: AttachmentBuilder[]; components: unknown[] }

/** Update the panel message in place (for instant, non-render actions). */
async function update(interaction: MessageComponentInteraction, payload: ViewPayload): Promise<void> {
  await interaction.update(payload as never);
}

type AnyInteraction = Interaction | MessageComponentInteraction | ModalSubmitInteraction;

/** Ephemeral one-off notice that doesn't disturb the panel. */
async function safeReply(interaction: AnyInteraction, content: string): Promise<void> {
  const i = interaction as MessageComponentInteraction;
  try {
    if (i.deferred || i.replied) await i.followUp({ content, flags: MessageFlags.Ephemeral });
    else await i.reply({ content, flags: MessageFlags.Ephemeral });
  } catch { /* ignore */ }
}

async function editOrReply(interaction: AnyInteraction, payload: ViewPayload): Promise<void> {
  const i = interaction as MessageComponentInteraction;
  try {
    if (i.deferred || i.replied) await i.editReply(payload as never);
    else if (i.isMessageComponent()) await i.update(payload as never);
  } catch (err) {
    logger.warn({ err }, "animate: failed to render panel");
  }
}

function failure(err: unknown): ViewPayload {
  const e = toEmojiError(err);
  return { content: `❌ ${e.message}`, files: [], components: [] };
}

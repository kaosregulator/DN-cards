import { readFile, stat } from "node:fs/promises";
import {
  AttachmentBuilder, MessageFlags,
  type Message, type TextChannel,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import type { PreparedRecording } from "./generate.js";

// ─────────────────────────────────────────────────────────────────────────────
// Discord native Voice Message sender
//
// Discord API (message flag IS_VOICE_MESSAGE = 1<<13 / 8192):
//  - Single audio attachment only (no content/embeds/components)
//  - Attachment needs duration_secs + waveform (base64 ≤256 bytes)
//  - Client format: mono Opus in OGG, 48kHz, ~32kbps
//  - Upload Content-Type must be audio/* or waveform/duration may be stripped
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceSendResult =
  | { ok: true; mode: "native" | "attachment"; message: Message; detail?: string }
  | { ok: false; mode: "failed"; error: string };

async function sendNativeViaRest(
  channel: TextChannel,
  recording: PreparedRecording,
): Promise<Message> {
  const client = channel.client;
  const token = client.token;
  if (!token) throw new Error("Missing bot token for voice message upload");

  const buf = await readFile(recording.filePath);
  const fileSize = (await stat(recording.filePath)).size;
  const filename = "voice-message.ogg";

  const attachRes = await fetch(
    `https://discord.com/api/v10/channels/${channel.id}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [{ id: "0", filename, file_size: fileSize }],
      }),
    },
  );
  if (!attachRes.ok) {
    throw new Error(`attachments endpoint ${attachRes.status}: ${await attachRes.text()}`);
  }
  const attachJson = await attachRes.json() as {
    attachments: { upload_url: string; upload_filename: string }[];
  };
  const slot = attachJson.attachments[0];
  if (!slot) throw new Error("No attachment upload slot returned");

  const putRes = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "audio/ogg" },
    body: buf,
  });
  if (!putRes.ok) {
    throw new Error(`upload PUT ${putRes.status}: ${await putRes.text()}`);
  }

  const msgRes = await fetch(
    `https://discord.com/api/v10/channels/${channel.id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flags: MessageFlags.IsVoiceMessage,
        attachments: [{
          id: "0",
          filename,
          uploaded_filename: slot.upload_filename,
          duration_secs: recording.durationSec,
          waveform: recording.waveformB64,
        }],
      }),
    },
  );
  if (!msgRes.ok) {
    throw new Error(`voice message create ${msgRes.status}: ${await msgRes.text()}`);
  }
  const raw = await msgRes.json() as { id: string };
  return channel.messages.fetch(raw.id);
}

async function sendAsAttachment(
  channel: TextChannel,
  recording: PreparedRecording,
): Promise<{ message: Message; attemptedNativeFlag: boolean }> {
  const file = new AttachmentBuilder(recording.filePath, {
    name: `${recording.title.replace(/\s+/g, "-").toLowerCase()}.ogg`,
  });
  try {
    const message = await channel.send({
      files: [file],
      flags: MessageFlags.IsVoiceMessage as never,
    });
    return { message, attemptedNativeFlag: true };
  } catch (err) {
    logger.debug({ err, audioId: recording.audioId }, "Attachment+IsVoiceMessage failed — plain attachment");
    const message = await channel.send({ files: [file] });
    return { message, attemptedNativeFlag: false };
  }
}

/**
 * Send a Quiet Room recording as a native Discord voice message when possible.
 * Falls back to a normal audio attachment — never throws for "not native".
 */
export async function sendQuietVoiceMessage(
  channel: TextChannel,
  recording: PreparedRecording,
): Promise<VoiceSendResult> {
  try {
    const message = await sendNativeViaRest(channel, recording);
    const native = Boolean(message.flags?.has(MessageFlags.IsVoiceMessage));
    if (native) {
      logger.info({
        audioId: recording.audioId,
        durationSec: recording.durationSec,
        sourceKind: recording.sourceKind,
        channelId: channel.id,
      }, "Quiet native voice message succeeded");
      return { ok: true, mode: "native", message, detail: "rest_upload_is_voice_message" };
    }
    logger.warn({
      audioId: recording.audioId,
      channelId: channel.id,
    }, "Quiet voice REST succeeded but IS_VOICE_MESSAGE flag missing — treating as attachment");
    return { ok: true, mode: "attachment", message, detail: "rest_ok_flag_missing" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({
      err,
      reason,
      audioId: recording.audioId,
      durationSec: recording.durationSec,
      sourceKind: recording.sourceKind,
      channelId: channel.id,
    }, "Quiet native voice message failed — trying attachment fallback");
    try {
      const { message, attemptedNativeFlag } = await sendAsAttachment(channel, recording);
      const native = Boolean(message.flags?.has(MessageFlags.IsVoiceMessage));
      if (native) {
        logger.info({
          audioId: recording.audioId,
          channelId: channel.id,
          attemptedNativeFlag,
        }, "Quiet native voice message succeeded via attachment path");
        return { ok: true, mode: "native", message, detail: "attachment_path_native" };
      }
      logger.info({
        audioId: recording.audioId,
        channelId: channel.id,
        reason,
        attemptedNativeFlag,
      }, "Quiet fallback attachment used");
      return { ok: true, mode: "attachment", message, detail: `fallback_after: ${reason}` };
    } catch (err2) {
      const error = err2 instanceof Error ? err2.message : String(err2);
      logger.error({
        err: err2,
        nativeFailReason: reason,
        audioId: recording.audioId,
        channelId: channel.id,
      }, "Quiet voice send failed entirely");
      return { ok: false, mode: "failed", error };
    }
  }
}

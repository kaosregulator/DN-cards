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
//
// discord.js can set MessageFlags.IsVoiceMessage, but duration/waveform are most
// reliable via the attachment upload REST flow. We try REST first, then fall
// back to a normal playable audio attachment (still useful, not native VM UI).
// ─────────────────────────────────────────────────────────────────────────────

export type VoiceSendResult =
  | { ok: true; mode: "native" | "attachment"; message: Message }
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

  // 1) Request upload URL
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

  // 2) PUT bytes with audio content-type
  const putRes = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "audio/ogg" },
    body: buf,
  });
  if (!putRes.ok) {
    throw new Error(`upload PUT ${putRes.status}: ${await putRes.text()}`);
  }

  // 3) Create voice message
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
  // Fetch through discord.js so callers get a real Message
  return channel.messages.fetch(raw.id);
}

async function sendAsAttachment(
  channel: TextChannel,
  recording: PreparedRecording,
): Promise<Message> {
  const file = new AttachmentBuilder(recording.filePath, {
    name: `${recording.title.replace(/\s+/g, "-").toLowerCase()}.ogg`,
  });
  // Try native flag with file upload (some API paths honor it).
  try {
    return await channel.send({
      files: [file],
      // discord.js typings omit IsVoiceMessage on MessageCreateOptions.flags;
      // cast — Discord accepts 8192 for native voice messages.
      flags: MessageFlags.IsVoiceMessage as never,
    });
  } catch {
    return channel.send({ files: [file] });
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
    // Heuristic: native VMs carry the flag on the created message.
    const native = Boolean(message.flags?.has(MessageFlags.IsVoiceMessage));
    return { ok: true, mode: native ? "native" : "attachment", message };
  } catch (err) {
    logger.warn({ err, audioId: recording.audioId }, "Native voice message failed — trying attachment fallback");
    try {
      const message = await sendAsAttachment(channel, recording);
      const native = Boolean(message.flags?.has(MessageFlags.IsVoiceMessage));
      return { ok: true, mode: native ? "native" : "attachment", message };
    } catch (err2) {
      const error = err2 instanceof Error ? err2.message : String(err2);
      logger.error({ err: err2 }, "Quiet voice send failed entirely");
      return { ok: false, mode: "failed", error };
    }
  }
}

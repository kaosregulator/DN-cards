// Shared chunker for packing long line lists into Discord embed fields.
// Enforces the 1024-char per-field cap with a 1000-char safety margin and
// caps the total fields per result (default 24 to leave room for one
// header/summary field). Sets `truncated:true` when the cap was hit so the
// caller can surface a follow-up hint to the user.
//
// Background: see `.agents/memory/discord-field-chunking.md` — silently
// over-stuffed field values make the entire `.editReply` fail with no error
// surfaced to the user. Always chunk; always guard empty values.

export interface ChunkOpts {
  baseName: string;
  separator?: string;
  maxValueChars?: number;
  maxFields?: number;
}

export interface ChunkResult {
  fields: { name: string; value: string; inline: false }[];
  truncated: boolean;
}

export function chunkLines(lines: string[], opts: ChunkOpts): ChunkResult {
  const sep = opts.separator ?? "\n";
  const max = opts.maxValueChars ?? 1000;
  const maxFields = opts.maxFields ?? 24;
  const fields: { name: string; value: string; inline: false }[] = [];
  let chunk = "";
  let part = 0;
  let truncated = false;

  const flush = () => {
    if (!chunk) return;
    if (fields.length >= maxFields) { truncated = true; chunk = ""; return; }
    fields.push({
      name: part === 0 ? opts.baseName : `${opts.baseName} (cont.)`,
      value: chunk,
      inline: false,
    });
    part++;
    chunk = "";
  };

  for (const line of lines) {
    const candidate = chunk ? chunk + sep + line : line;
    if (chunk && candidate.length > max) {
      flush();
      if (truncated) break;
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (!truncated) flush();
  return { fields, truncated };
}

// Pack pre-built fields into multiple screens (embeds), each capped at
// `fieldsPerScreen` fields. Returns 1+ EmbedBuilder via the factory.
export function paginateFields<T>(
  items: T[],
  perScreen: number,
): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += perScreen) {
    out.push(items.slice(i, i + perScreen));
  }
  return out;
}

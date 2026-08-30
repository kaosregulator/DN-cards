// ─────────────────────────────────────────────────────────────────────────────
// Debug traces.
//
// A generation that goes wrong in production is hard to reason about without
// seeing what the page actually did. This writes the recorded exchanges to a
// file when debug mode is on — never to the ordinary logs, where it would both
// drown everything else and put request bodies somewhere they don't belong.
//
// Traces are already redacted by the recorder before they reach here. This layer
// adds the other half of the safety: it is OFF unless explicitly enabled, and it
// bounds how many files it will leave behind.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../../../lib/logger.js";
import type { RecordedExchange } from "./discovery/recorder.js";

/** Set to a directory path to turn tracing on. */
const ENV_DEBUG_DIR = "MAKEEMOJI_DEBUG_DIR";

/** Oldest traces are pruned past this, so tracing can't fill a disk. */
const MAX_TRACE_FILES = 20;

/** The debug directory, or null when tracing is disabled. */
export function debugDir(): string | null {
  const dir = process.env[ENV_DEBUG_DIR]?.trim();
  return dir && dir.length > 0 ? dir : null;
}

export function isDebugEnabled(): boolean {
  return debugDir() !== null;
}

/** Write one trace. Never throws: a failed trace must not fail a generation. */
export function writeDebugTrace(
  label: string, exchanges: RecordedExchange[], websockets: string[] = [],
): string | null {
  const dir = debugDir();
  if (!dir) return null;

  try {
    mkdirSync(dir, { recursive: true });
    prune(dir);

    const path = join(dir, `${label}-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({
      label,
      at: new Date().toISOString(),
      note: "Credential headers and query/body secrets are redacted by the recorder.",
      websockets,
      exchanges,
    }, null, 2));
    logger.info({ path, exchanges: exchanges.length }, "MakeEmoji debug trace written");
    return path;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "could not write MakeEmoji debug trace");
    return null;
  }
}

function prune(dir: string): void {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort();
  for (const file of files.slice(0, Math.max(0, files.length - MAX_TRACE_FILES + 1))) {
    rmSync(join(dir, file), { force: true });
  }
}

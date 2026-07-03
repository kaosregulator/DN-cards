import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = "/tmp/dn-img-cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(objectPath: string, width?: number): string {
  const raw = width ? `${objectPath}@w${width}` : objectPath;
  return createHash("sha256").update(raw).digest("hex");
}

export interface CachedImage {
  data: Buffer;
  contentType: string;
}

export async function getCachedImage(
  objectPath: string,
  width?: number,
): Promise<CachedImage | null> {
  const key = cacheKey(objectPath, width);
  const dataFile = join(CACHE_DIR, key);
  const metaFile = `${dataFile}.meta`;
  try {
    const metaStat = await stat(metaFile);
    if (Date.now() - metaStat.mtimeMs > CACHE_TTL_MS) return null;
    const [data, metaRaw] = await Promise.all([
      readFile(dataFile),
      readFile(metaFile, "utf8"),
    ]);
    const { contentType } = JSON.parse(metaRaw) as { contentType: string };
    return { data, contentType };
  } catch {
    return null;
  }
}

export async function setCachedImage(
  objectPath: string,
  data: Buffer,
  contentType: string,
  width?: number,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const key = cacheKey(objectPath, width);
    const dataFile = join(CACHE_DIR, key);
    await Promise.all([
      writeFile(dataFile, data),
      writeFile(`${dataFile}.meta`, JSON.stringify({ contentType })),
    ]);
  } catch {
    // cache write failure is non-fatal
  }
}

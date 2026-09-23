import { logger } from "../../../lib/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Openverse audio client (search + detail)
// Docs: https://docs.openverse.org/api/reference/search_algorithm.html
// API:  https://api.openverse.org/v1/audio/
//
// Used to discover/verify CC0 ambience and optionally refresh curated media.
// Anonymous rate limits apply — identify with a clear User-Agent.
// ─────────────────────────────────────────────────────────────────────────────

const OPENVERSE_BASE = "https://api.openverse.org/v1";
const UA = "DN-Cards-QuietRoom/1.1 (https://github.com/kaosregulator/DN-cards; quiet-mode audio)";

export interface OpenverseAudioResult {
  id: string;
  title: string;
  url: string;
  creator: string | null;
  creator_url: string | null;
  license: string;
  license_version: string | null;
  license_url: string | null;
  foreign_landing_url: string;
  provider: string;
  source: string;
  duration: number | null;
  attribution: string | null;
  filetype: string | null;
  mature: boolean;
}

export interface OpenverseSearchResponse {
  result_count: number;
  page_count: number;
  page: number;
  results: OpenverseAudioResult[];
}

async function ovFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });
}

/** Search Openverse audio. Prefer license=cc0 for Quiet Room curation. */
export async function searchOpenverseAudio(opts: {
  q: string;
  license?: string;
  pageSize?: number;
  page?: number;
  length?: "shortest" | "short" | "medium" | "long";
}): Promise<OpenverseSearchResponse> {
  const params = new URLSearchParams({
    q: opts.q,
    license: opts.license ?? "cc0",
    page_size: String(opts.pageSize ?? 8),
    page: String(opts.page ?? 1),
  });
  if (opts.length) params.set("length", opts.length);

  const url = `${OPENVERSE_BASE}/audio/?${params}`;
  const res = await ovFetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Openverse search ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<OpenverseSearchResponse>;
}

export async function getOpenverseAudio(id: string): Promise<OpenverseAudioResult> {
  const res = await ovFetch(`${OPENVERSE_BASE}/audio/${id}/`);
  if (!res.ok) {
    throw new Error(`Openverse detail ${res.status} for ${id}`);
  }
  return res.json() as Promise<OpenverseAudioResult>;
}

/** Download a media URL (Openverse `url` / Freesound preview) to a Buffer. */
export async function downloadOpenverseMedia(mediaUrl: string): Promise<Buffer> {
  const res = await fetch(mediaUrl, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`media download ${res.status} for ${mediaUrl}`);
  }
  const ab = await res.arrayBuffer();
  logger.debug({ mediaUrl, bytes: ab.byteLength }, "Openverse media downloaded");
  return Buffer.from(ab);
}

/** True when Openverse license string is safe for Quiet Room redistribution. */
export function isQuietSafeLicense(license: string | null | undefined): boolean {
  const l = (license ?? "").toLowerCase();
  return l === "cc0" || l === "pdm" || l === "cc0 1.0";
}

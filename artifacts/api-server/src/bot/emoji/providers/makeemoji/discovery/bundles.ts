// ─────────────────────────────────────────────────────────────────────────────
// JavaScript bundle analysis.
//
// The network trace shows what the page DID during one run. The bundles show
// what it CAN do — endpoints behind a code path we didn't trigger, and the
// encoder libraries that reveal whether generation happens in the browser at
// all. A site that ships gif.js and a WebWorker is not calling a backend, and
// that conclusion changes the whole integration.
//
// Everything here is read-only analysis of publicly served files.
// ─────────────────────────────────────────────────────────────────────────────

/** URL-ish strings that look like an API route. */
const ENDPOINT_PATTERNS = [
  /["'`](\/api\/[a-z0-9\-_/.]{2,80})["'`]/gi,
  /["'`](https?:\/\/[a-z0-9.\-]+\/(?:api|v\d)\/[a-z0-9\-_/.]{2,80})["'`]/gi,
  /["'`](\/(?:upload|uploads|generate|render|process|convert|export|download|emoji|jobs?|tasks?)(?:\/[a-z0-9\-_/.]{0,60})?)["'`]/gi,
];

/**
 * Signatures of client-side encoding. A hit means the browser can produce the
 * output itself, which makes a "no backend endpoint" finding believable rather
 * than merely unproven.
 */
const CLIENT_SIDE_SIGNATURES: [string, RegExp][] = [
  ["gif.js", /\bgif\.?js\b|GIFEncoder|NeuQuant/],
  ["gifenc", /\bgifenc\b|quantize\s*\(/],
  ["gifshot", /\bgifshot\b/],
  ["WebAssembly", /WebAssembly\.(instantiate|compile)|\.wasm\b/],
  ["ffmpeg.wasm", /ffmpeg[-.]?wasm|createFFmpeg/],
  ["OffscreenCanvas", /OffscreenCanvas/],
  ["WebWorker", /new\s+Worker\s*\(/],
  ["MediaRecorder", /new\s+MediaRecorder\b/],
  ["canvas.toBlob", /toBlob\s*\(|toDataURL\s*\(/],
  ["WebCodecs", /VideoEncoder|ImageDecoder/],
];

/** Signatures of a network-backed pipeline. */
const BACKEND_SIGNATURES: [string, RegExp][] = [
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["axios", /\baxios\b/],
  ["FormData", /new\s+FormData\b/],
  ["GraphQL", /graphql|__typename/i],
  ["WebSocket", /new\s+WebSocket\b/],
  ["S3 presign", /X-Amz-Signature|presigned?[-_]?url/i],
  ["job polling", /\bpoll(ing)?\b.{0,40}\b(job|task|status)\b/i],
];

export interface BundleReport {
  url: string;
  bytes: number;
  /** HTTP status, or null when the fetch itself failed. */
  status: number | null;
  error?: string;
  /** Candidate API routes found as string literals. */
  endpoints: string[];
  clientSideHits: string[];
  backendHits: string[];
  /** Source map URL declared by the bundle, when it has one. */
  sourceMappingUrl: string | null;
  /** True when that source map was actually fetchable. */
  sourceMapAvailable: boolean;
  /** Original file paths from the source map — the clearest view of the code. */
  sourceMapSources: string[];
}

function findAll(source: string, patterns: RegExp[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    // The patterns are global; reset lastIndex so reuse across files is safe.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) found.add(match[1]);
      if (found.size > 200) return [...found];
    }
  }
  return [...found];
}

function matchSignatures(source: string, signatures: [string, RegExp][]): string[] {
  return signatures.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

/** Fetch and analyse one script. Never throws — a failure is part of the report. */
export async function analyzeBundle(
  url: string,
  fetchText: (url: string) => Promise<{ status: number; body: string }>,
): Promise<BundleReport> {
  const base: BundleReport = {
    url, bytes: 0, status: null, endpoints: [], clientSideHits: [], backendHits: [],
    sourceMappingUrl: null, sourceMapAvailable: false, sourceMapSources: [],
  };

  let body: string;
  try {
    const res = await fetchText(url);
    base.status = res.status;
    body = res.body;
    base.bytes = body.length;
    if (res.status >= 400) return base;
  } catch (err) {
    base.error = (err as Error).message;
    return base;
  }

  base.endpoints = findAll(body, ENDPOINT_PATTERNS);
  base.clientSideHits = matchSignatures(body, CLIENT_SIDE_SIGNATURES);
  base.backendHits = matchSignatures(body, BACKEND_SIGNATURES);

  // Source maps, when published, name the original files — the fastest way to
  // see how the pipeline is actually organised.
  const mapMatch = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(body);
  if (mapMatch?.[1] && !mapMatch[1].startsWith("data:")) {
    const mapUrl = new URL(mapMatch[1], url).toString();
    base.sourceMappingUrl = mapUrl;
    try {
      const res = await fetchText(mapUrl);
      if (res.status < 400) {
        const map = JSON.parse(res.body) as { sources?: string[] };
        base.sourceMapAvailable = true;
        base.sourceMapSources = (map.sources ?? []).slice(0, 200);
      }
    } catch { /* absent or unparsable source maps are an ordinary finding */ }
  }

  return base;
}

/** What the bundle evidence implies about where processing happens. */
export type ProcessingVerdict = "client-side" | "backend" | "mixed" | "inconclusive";

export function classifyProcessing(reports: BundleReport[]): {
  verdict: ProcessingVerdict;
  clientSide: string[];
  backend: string[];
  endpoints: string[];
} {
  const clientSide = [...new Set(reports.flatMap(r => r.clientSideHits))];
  const backend = [...new Set(reports.flatMap(r => r.backendHits))];
  const endpoints = [...new Set(reports.flatMap(r => r.endpoints))];

  // `fetch` and `FormData` are in every modern bundle for analytics and fonts,
  // so they are not on their own evidence of a generation backend. Requiring a
  // real endpoint or an upload signature keeps the verdict honest.
  const strongBackend = endpoints.length > 0
    || backend.includes("S3 presign")
    || backend.includes("job polling")
    || backend.includes("GraphQL");
  const strongClient = clientSide.some(h =>
    h !== "canvas.toBlob" && h !== "WebWorker" && h !== "OffscreenCanvas");

  const verdict: ProcessingVerdict =
    strongClient && strongBackend ? "mixed"
    : strongClient ? "client-side"
    : strongBackend ? "backend"
    : "inconclusive";

  return { verdict, clientSide, backend, endpoints };
}

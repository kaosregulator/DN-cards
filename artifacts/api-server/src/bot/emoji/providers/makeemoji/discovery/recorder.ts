// ─────────────────────────────────────────────────────────────────────────────
// Network recorder.
//
// Attaches to a Playwright page and records every request/response pair so a
// discovery run can answer the only question that matters: which request
// actually generates the emoji?
//
// REDACTION IS NOT OPTIONAL HERE. These recordings are written to disk and get
// pasted into issues and chat logs. Anything that could authenticate as the
// browser — cookies, auth headers, tokens in query strings — is replaced with a
// marker that preserves the SHAPE (so you can still see "there was a bearer
// token here") without the value.
// ─────────────────────────────────────────────────────────────────────────────

import type { Page, Request, Response } from "playwright";

/** Header names whose values never reach disk. */
const SENSITIVE_HEADERS = new Set([
  "cookie", "set-cookie", "authorization", "proxy-authorization",
  "x-api-key", "x-auth-token", "x-csrf-token", "x-xsrf-token",
  "x-session-token", "x-access-token", "authentication",
]);

/** Query/body parameter names whose values never reach disk. */
const SENSITIVE_PARAMS = [
  "token", "auth", "key", "secret", "password", "session", "sig", "signature",
  "credential", "access_token", "id_token", "apikey", "api_key",
];

const REDACTED = "[redacted]";

/** Replace a value with a shape-preserving marker. */
function redactValue(value: string): string {
  return `${REDACTED}:${value.length}chars`;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? redactValue(value) : value;
  }
  return out;
}

/** Strip secrets from a URL's query string, keeping the path and shape intact. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const [name, value] of url.searchParams) {
      if (SENSITIVE_PARAMS.some(p => name.toLowerCase().includes(p))) {
        url.searchParams.set(name, redactValue(value));
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Redact a request body.
 *
 * Bodies are also truncated: a multipart upload embeds the whole source image,
 * and writing megabytes of base64 into the report would bury the one line that
 * actually identifies the endpoint.
 */
const MAX_BODY_CHARS = 4000;

export function redactBody(body: string | null): string | null {
  if (body === null) return null;

  let out = body;
  for (const param of SENSITIVE_PARAMS) {
    // Match `"token":"…"` (JSON) and `token=…` (form encoding) alike.
    out = out.replace(
      new RegExp(`("${param}"\\s*:\\s*")([^"]*)(")`, "gi"),
      (_m, a: string, v: string, c: string) => a + redactValue(v) + c,
    );
    out = out.replace(
      new RegExp(`(\\b${param}=)([^&\\s]+)`, "gi"),
      (_m, a: string, v: string) => a + redactValue(v),
    );
  }

  if (out.length > MAX_BODY_CHARS) {
    out = `${out.slice(0, MAX_BODY_CHARS)}…[truncated ${out.length - MAX_BODY_CHARS} chars]`;
  }
  return out;
}

/** One recorded exchange. */
export interface RecordedExchange {
  /** Milliseconds since recording started — orders the flow. */
  at: number;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  postData: string | null;
  status: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  contentType: string | null;
  /** Response body length in bytes, when known. */
  responseBytes: number | null;
  /** True when the response looked like an image/video rather than text. */
  binary: boolean;
  /** Set when the request failed outright. */
  failure: string | null;
}

export interface Recorder {
  /** Everything seen so far, in order. */
  exchanges: RecordedExchange[];
  /** Detach the listeners. */
  stop(): void;
  /** WebSocket URLs opened during the run. */
  websockets: string[];
}

/** Response content types that are the actual generated artefact, not markup. */
export function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /^(image|video|audio|application\/octet-stream)/i.test(contentType);
}

/** Start recording a page's network activity. */
export function recordNetwork(page: Page): Recorder {
  const started = Date.now();
  const exchanges: RecordedExchange[] = [];
  const websockets: string[] = [];
  const pending = new Map<Request, RecordedExchange>();

  const onRequest = (request: Request) => {
    const exchange: RecordedExchange = {
      at: Date.now() - started,
      method: request.method(),
      url: redactUrl(request.url()),
      resourceType: request.resourceType(),
      requestHeaders: {},
      postData: redactBody(request.postData()),
      status: null,
      statusText: null,
      responseHeaders: {},
      contentType: null,
      responseBytes: null,
      binary: false,
      failure: null,
    };
    pending.set(request, exchange);
    exchanges.push(exchange);
  };

  const onResponse = (response: Response) => {
    const exchange = pending.get(response.request());
    if (!exchange) return;
    exchange.status = response.status();
    exchange.statusText = response.statusText();
    const headers = response.headers();
    exchange.responseHeaders = redactHeaders(headers);
    exchange.contentType = headers["content-type"] ?? null;
    exchange.binary = isBinaryContentType(exchange.contentType);
    const length = Number(headers["content-length"] ?? NaN);
    exchange.responseBytes = Number.isFinite(length) ? length : null;
  };

  const onFailed = (request: Request) => {
    const exchange = pending.get(request);
    if (exchange) exchange.failure = request.failure()?.errorText ?? "failed";
  };

  const onWebSocket = (ws: { url(): string }) => {
    websockets.push(redactUrl(ws.url()));
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  page.on("websocket", onWebSocket);

  // Request headers are only final once the request is issued, so they are read
  // here rather than in the `request` handler.
  page.on("requestfinished", async (request: Request) => {
    const exchange = pending.get(request);
    if (!exchange) return;
    try {
      exchange.requestHeaders = redactHeaders(await request.allHeaders());
    } catch { /* the page may have navigated away; the exchange is still useful */ }
  });

  return {
    exchanges,
    websockets,
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
      page.off("websocket", onWebSocket);
    },
  };
}

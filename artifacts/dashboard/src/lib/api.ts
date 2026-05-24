const ADMIN_TOKEN_KEY = "dn-admin-token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function parseError(res: Response, path: string): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  const msg = body?.error ?? `API ${res.status}: ${path}`;
  return new ApiError(res.status, msg, body?.details);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: adminHeaders() });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function adminSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: adminHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

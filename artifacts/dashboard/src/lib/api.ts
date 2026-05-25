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

/** Resolve an imageUrl that may be an absolute URL or an object-storage path (`/objects/...`). */
export function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/objects/")) return `/api/storage${url}`;
  return url;
}

/** Admin-only: request a presigned PUT URL + final objectPath. */
export async function requestUploadUrl(contentType: string): Promise<{ uploadURL: string; objectPath: string }> {
  return adminSend("POST", "/api/admin/uploads/request-url", { contentType });
}

/** Admin: upload a File to object storage; resolves to the storage path (`/objects/...`). */
export async function uploadImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files are supported.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image must be 8 MB or smaller.");
  const { uploadURL, objectPath } = await requestUploadUrl(file.type);
  const put = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return objectPath;
}

async function parseError(res: Response, path: string): Promise<ApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  const msg = body?.error ?? `API ${res.status}: ${path}`;
  return new ApiError(res.status, msg, body?.details);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" }, credentials: "include" });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function apiSend<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

function adminHeaders(): Record<string, string> {
  // Master ADMIN_TOKEN is still supported as a legacy/break-glass header.
  // Normal users authenticate with the session cookie set by /api/auth/login.
  const token = getAdminToken();
  const h: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: adminHeaders(), credentials: "include" });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

export async function adminSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: adminHeaders(),
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, path);
  return res.json() as Promise<T>;
}

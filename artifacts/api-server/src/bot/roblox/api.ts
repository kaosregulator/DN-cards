// ── Roblox public Web API client ──────────────────────────────────────────────
// Uses only unauthenticated, public Roblox endpoints — no OAuth app, no API
// key, no cookies. This is the same surface Bloxlink-style verification relies
// on:
//   - users.roblox.com/v1/usernames/users  → resolve a username to an id
//   - users.roblox.com/v1/users/{id}        → fetch profile (incl. "About" blurb)
//   - groups.roblox.com/v1/users/{id}/groups/roles → group memberships + ranks
//
// Every call is wrapped with a timeout and returns null / [] on failure so a
// Roblox outage degrades gracefully instead of throwing into the command.

const USERS_BASE = "https://users.roblox.com/v1";
const GROUPS_BASE = "https://groups.roblox.com/v1";
const THUMBS_BASE = "https://thumbnails.roblox.com/v1";
const DEFAULT_TIMEOUT_MS = 8000;

export interface RobloxUser {
  id: string;
  name: string;
  displayName: string | null;
}

export interface RobloxUserProfile extends RobloxUser {
  description: string;
}

export interface RobloxGroupMembership {
  groupId: string;
  groupName: string;
  roleName: string;
  rank: number;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Resolve a Roblox username (case-insensitive) to a user. Returns null when the
// username doesn't exist or Roblox is unreachable.
export async function resolveUsername(username: string): Promise<RobloxUser | null> {
  const body = JSON.stringify({
    usernames: [username],
    excludeBannedUsers: false,
  });
  const json = await fetchJson(`${USERS_BASE}/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const hit = json?.data?.[0];
  if (!hit?.id) return null;
  return {
    id: String(hit.id),
    name: hit.name,
    displayName: hit.displayName ?? null,
  };
}

// Fetch a Roblox user's full profile, including the "About" description blurb
// used for code verification.
export async function getUserProfile(robloxUserId: string): Promise<RobloxUserProfile | null> {
  const json = await fetchJson(`${USERS_BASE}/users/${encodeURIComponent(robloxUserId)}`);
  if (!json?.id) return null;
  return {
    id: String(json.id),
    name: json.name,
    displayName: json.displayName ?? null,
    description: typeof json.description === "string" ? json.description : "",
  };
}

// List the groups a Roblox user belongs to, with their rank in each.
export async function getUserGroups(robloxUserId: string): Promise<RobloxGroupMembership[]> {
  const json = await fetchJson(`${GROUPS_BASE}/users/${encodeURIComponent(robloxUserId)}/groups/roles`);
  const data: any[] = json?.data ?? [];
  return data
    .filter((d) => d?.group?.id != null && d?.role != null)
    .map((d) => ({
      groupId: String(d.group.id),
      groupName: d.group.name ?? "",
      roleName: d.role.name ?? "",
      rank: Number(d.role.rank ?? 0),
    }));
}

// Convenience: the user's membership in one specific group (or null).
export async function getGroupMembership(
  robloxUserId: string,
  groupId: string,
): Promise<RobloxGroupMembership | null> {
  const groups = await getUserGroups(robloxUserId);
  return groups.find((g) => g.groupId === String(groupId)) ?? null;
}

// Best-effort headshot thumbnail URL for a Roblox user (used as embed
// thumbnail). Returns null if unavailable.
export async function getAvatarThumbnail(robloxUserId: string): Promise<string | null> {
  const json = await fetchJson(
    `${THUMBS_BASE}/users/avatar-headshot?userIds=${encodeURIComponent(robloxUserId)}&size=150x150&format=Png&isCircular=false`,
  );
  const url = json?.data?.[0]?.imageUrl;
  return typeof url === "string" ? url : null;
}

export function profileUrl(robloxUserId: string): string {
  return `https://www.roblox.com/users/${encodeURIComponent(robloxUserId)}/profile`;
}

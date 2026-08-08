// Detect whether we are running embedded inside Discord.
//
// Discord launches the Activity iframe with `frame_id` (and `instance_id`)
// query params. Their presence is the canonical signal that the Embedded App
// SDK can hand-shake. Absent them, we are in a normal browser (local dev).

export function isInDiscord(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return q.has("frame_id");
}

export function discordQueryParams(): { frameId: string | null; instanceId: string | null } {
  const q = new URLSearchParams(window.location.search);
  return { frameId: q.get("frame_id"), instanceId: q.get("instance_id") };
}

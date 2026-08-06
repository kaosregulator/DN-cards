// ─────────────────────────────────────────────────────────────────────────────
// HQ — per-key serialization lock.
//
// Several HQ mutations are read-modify-write sequences (check cooldown/shield →
// resolve → persist → reward; read placements → check cap → clear → write). The
// bot runs as a SINGLE process, so rapid/concurrent Discord clicks can interleave
// those steps and bypass limits or double-apply. `withHqLock(key, fn)` runs `fn`
// to completion before the next call with the same key starts — turning each
// critical section into an atomic unit without a DB advisory lock.
//
// Keys are scoped so unrelated work never blocks (e.g. per attacker for sieges,
// per user for placements). The map self-prunes when a key's chain drains.
// ─────────────────────────────────────────────────────────────────────────────

const tails = new Map<string, Promise<unknown>>();

export function withHqLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for the current tail (ignoring its outcome), then run fn.
  const prev = (tails.get(key) ?? Promise.resolve()).catch(() => {});
  const run = prev.then(fn);
  tails.set(key, run);
  // Drop the entry once this run settles, but only if nothing newer queued behind it.
  void run.catch(() => {}).finally(() => { if (tails.get(key) === run) tails.delete(key); });
  return run;
}

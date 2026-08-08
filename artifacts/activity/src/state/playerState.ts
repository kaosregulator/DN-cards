// Player State store — the client-side cache of the AUTHORITATIVE snapshot the
// backend returns. Never mutated to grant anything; it is a read model. Writes
// (edits, purchases, battle results) will always round-trip to the server in
// later phases and replace this snapshot with the server's response.

import type { PlayerSnapshot } from "../net/api";

export class PlayerState {
  private snapshot: PlayerSnapshot | null = null;

  set(snapshot: PlayerSnapshot): void {
    this.snapshot = snapshot;
  }

  get(): PlayerSnapshot | null {
    return this.snapshot;
  }

  get isLoaded(): boolean {
    return this.snapshot !== null;
  }
}

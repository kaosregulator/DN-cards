---
name: Embedded Activity OAuth scope
description: Scope discipline for Discord Embedded App OAuth handshakes.
---

Discord Embedded Activities should request only the OAuth scopes required by their API calls; the DN Cards Activity identity flow needs `identify`, not guild-member scopes.

**Why:** Extra scopes can make the embedded authorization/authenticate sequence fail or depend on Discord app permissions unrelated to the Activity, while identity lookup via `/users/@me` needs only `identify`.

**How to apply:** Keep the Activity scope list minimal and add a scope only when a concrete backend endpoint requires it and the Discord app is configured for that scope.
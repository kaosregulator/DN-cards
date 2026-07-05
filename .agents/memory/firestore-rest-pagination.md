---
name: Firestore REST pagination
description: Firestore REST API paginates document lists; follow nextPageToken to load the full collection.
---

## Rule
Firestore `documents: list` requests return at most `pageSize` documents (default 20, max 100) and include a `nextPageToken` when more exist. To load a complete collection, loop on `nextPageToken` until it is absent, and log a warning if a safety page cap is reached.

**Why:** A naive single-request fetch silently returns only the first page of data. For the MTTValues source this meant only 100 of 294 items were loaded, so searches for items in later pages returned no results.

**How to apply:**
- Pass `pageSize=100` to minimize round trips.
- Append `&pageToken=<token>` to the base URL for subsequent requests.
- Keep a `maxPages` safety cap (e.g., 50) so an unexpectedly large collection cannot hang the process, but log/throw if the cap is hit rather than silently truncating.
- Respect the cache TTL: once the full collection is loaded, cache it in memory until the TTL expires.

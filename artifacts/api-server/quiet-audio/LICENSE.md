# Quiet Audio — licenses & provenance

## Layers

1. **Curated recordings** — discovered via the [Openverse audio search API](https://api.openverse.org/v1/audio/)
   (`license=cc0`), verified against each result’s `license` / `license_url` /
   `attribution` fields, then harvested into `quiet-audio/sources/`.
2. **Procedural ambience** — generated with ffmpeg (original / public domain).
3. **Spoken quotes** — synthesized with ffmpeg **flite** when available, mixed
   into ambience; quote text is original project content.

See **[SOURCES.md](./SOURCES.md)** for the full curated clip table (Openverse id,
creator, landing URL, CC0 link).

## Openverse

- Search algorithm docs: https://docs.openverse.org/api/reference/search_algorithm.html
- Harvest script: `node scripts/harvest-quiet-audio.mjs`
- Runtime client: `src/bot/quiet/audio/openverse.ts`

Openverse cannot guarantee license metadata accuracy; we only ship clips that
returned `license: "cc0"` and we keep attribution for provenance even though
CC0 does not require it.

## Capability flags (all curated CC0 clips)

| Flag | Value |
|------|-------|
| Redistribution | allowed |
| Commercial use | allowed |
| Modification / remix | allowed |
| Attribution required | no (CC0) — still recorded |

## Do not add

- Copyrighted commercial songs / YouTube rips
- “Free download” sites without a clear redistribution license
- CC-BY-NC / ND clips (we stick to CC0 / PD for Quiet Room remixes)

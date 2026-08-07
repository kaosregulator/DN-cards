# Kaos HQ — UI reference mockups

Design mockups uploaded by the project owner (kaosregulator) as visual reference
for the HQ / world / base-editor direction. These are **aspirational UI targets**,
not literal specs — the bot renders to Discord embeds + canvas today, so treat
these as the look, layout and feature intent to work toward.

They're especially relevant to the **world-map "Conquests"** idea (repeatable
mini-outposts like oil rigs / diamond mines / water entryways that are captured
for resources) and the **resource economy** — note the **Gold Mine** building and
**Storage / Income Bonus** stats that appear here.

| File | Screen | Key elements to notice |
|---|---|---|
| `01-…scene_a.png` | **Base overview** (`Kaos base`, HQ Lv 10) | Isometric base with castle, river, fences, trees. Placed buildings: **Mounted Turret**, **Defender**, **Gold Mine** (a resource generator). Right rail: **Base Upgrade** (Health / Defense / **Storage** / **Income Bonus**), **Buy Shield** (timer), Quick Actions. Bottom: `Upgrade → Stronghold (+10%) · 1,500 💎`. |
| `02-…editor_scene.png` | **Base editor — Edit Mode** | Left: place **Terrain / Water / Structures / Decorations / Fences / Clear**. Right rail: **Fences**, **Backdrops (skybox)** — Outside/Night/Winter/Fall/Beach/Desert/Space/Clouds, **Floor Tiles**. Bottom palette tabs: **Trees / Rocks / Decor / Buildings**; **Quick Layers** toggles; Grid toggle; Undo/Redo; Save Base. |
| `03-…isometric_st.png` | **Base editor — Move Mode** | Same editor mid-drag: **Selected item** card (Pine Tree), directional move arrows, **Place / Cancel**. Note the **water tile + bridge** — relevant to "water entryways". |
| `04-…room_editor.png` | **Room interior editor** (Command Center, Lv 5) | Interior isometric room. Categories: **Walls / Doors / Floors / Decor / Furniture / Lighting / Trophies / Defense**. Wall picker + **Wall Settings** (height/color). **Room Themes** strip (Command Center, Armory, Research Lab, Trophy Hall, War Room, Treasury, Barracks, Workshop). Room info shows stat bonuses (Troop Capacity / Rally Points / Command Power). |
| `05-…dashboard.png` | **Room interior editor** (alt palette) | Same room editor, lighter stone theme + **Room Blueprints** strip and a fuller wall set (Stone/Castle/Wood/Gold/Crystal/Spiked). Shows **Move Mode** placing a wall segment, **Room Stats** panel, Save as Blueprint / Save Changes. |

## Currency note
The mockups show a blue **💎 gem**-style currency for upgrades/shields. The live
game currently uses **shards** through the existing market economy (see
`lib/db/src/schema/market.ts` and `hq/shop.ts`) — there is **no second currency
yet**. If Conquests introduce a build/decorate **resource**, that's a new economy
decision, not something already present.

## Related code
- World map + territories: `artifacts/api-server/src/bot/hq/defs/world.ts`, `hq/world.ts`, `hq/render-world.ts`
- Siege engine (reused for capturing nodes): `hq/siege-runtime.ts`, `hq/siege-battle.ts`
- Base/room editor + assets: `hq/build-options.ts`, `hq/terrain.ts`, `hq/render.ts`, `hq/defs/*`

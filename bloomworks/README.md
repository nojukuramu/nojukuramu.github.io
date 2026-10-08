# Bloomworks — an idle game of glowing contraptions

An idle game about placing glowing contraptions on an endless grey world. Light flows through
your machines, turns into Glow, and brings the land back to life. It implements the design
document *Bloomworks — Idle Game Mechanics* (Oct 2026): every system in it, with its numbers.

Top-down 3D in Three.js (vendored r160, the same build Hacks and Magic Sandbox carry), with real
shadows from a sun that crosses the sky, a bloom pass so everything that glows bleeds light into
the night, and every unit of value drawn as a mote you can watch. Touch first, also mouse and
keys. Plays offline once installed. No build step, no model files, no audio files.

## Running it

Serve the folder (`npx http-server bloomworks` or any static server) and open it. A first visit
places one Wellspring, two Tracks and one Hearth; motes start rolling at once.

| Check | Command |
|-------|---------|
| Static and behaviour checks (109) | `node tools/validate.js` |
| The game in a real browser (26) | `node tools/e2e.js [--shots dir]` |

`validate.js` also lets a simple greedy player (Wellsprings, one Polisher and Levels only) run
Season 1 and prints how far it gets: about 10 minutes to 1K Glow and 70 minutes to the first
Harvest. The design's 44 minutes comes from a model that also uses Kilns, Extractors, plots,
Fusers and Chimes.

## What is implemented

**The world.** An endless grid of 10×10 plots grown from one seed; Rings, edge-adjacent
claiming at `900 × 8^(r−1) × 1.25^m`; ten biomes by Ring (Meadow to Anomaly, whose rules come
from a pool and never run out); all fourteen tile kinds with their effects; Nodes with
Richness `1.6^r` and Tier `1 + ⌊r/3⌋`; Ruins in about one plot in six, excavated for Wonders,
Relics, Mods and Lore pages.

**The living world.** A 12-minute day (Seasons change it), Sun Dishes by day and Moon Wells by
night; weather per biome every 4–8 minutes with a 2-minute forecast, including Storms whose
strikes fire Storm Rods and charge Chimes, rare night Auroras and hourly Meteor Showers that
leave Starstone; Bloom with no cap (`10^(n+1)` XP, ×1.1 Power a level) spreading from the
busiest contraption, Overgrowth kept through a Harvest; forty critters, three common and one
weather-shy rare per biome, each doing its job; Golden Moths.

**Motes.** Tier (shapes that cycle every eight Tiers, with a halo per cycle), Value, Hue
(primaries, secondaries, Prismatic), Stamps once per processor, Lucky and Charged; fusion with
Fusion and Hue Bonuses; Hearth Wishes; Tracks that queue and never lose a mote; Strays.

**Contraptions.** All 24 types in seven families, the eight Wonders and the three Celestial
designs, with sizes, rotation, free moving and 100% refunds, tile and neighbour bonuses, Tempo,
Power, Overclock, Milestones every 25 Levels and Material waves across the map.

**Upgrades.** Type Levels (×1, ×10, ×25, next Milestone, Max), Specializations at Level 100, the
Workshop, Mods with slots, merging and Ascended rarities, Relics with endless levels.

**Spectacle.** Combo per Hearth with its flame, Lucky up to Supernova (half a second of slow
motion), Chime Chains that play pentatonic melodies, Rush, number pops, Zen Mode, and a
Time-lapse of your time away.

**Automation.** Tinkers that walk the world (Builder, Upgrader with four rules, Courier with
links, Scout, Keeper); Ghosts after every Harvest; Blueprints saved, rotated, stamped and shared
as text codes; Directives (up to three AND conditions, nine kinds of action); offline progress
with the Offline Rate, the time cap, Moth Jars and a Logbook.

**Goals.** Commissions with Rank, Windfalls, the Wandering Merchant, endless Feat tiers and
hidden Feats, the Codex with chapter bonuses, and the four secrets: hidden sales, Chime songs,
weather-shy critters and Ruins riddles.

**Prestige.** Seasons (Spring, Summer, Autumn, Winter) and Harvests for Seeds
(`⌊10 × (L/10^6)^(1/3)⌋`), the Seed Tree; Eclipses for Stars (`⌊3 × (S/10^6)^(1/2)⌋`) with a
30-second dark show, the Sky with nine Constellations and endless Wild ones, six Trials with
endless Ranks, the World Heart's seven Stages; Genesis into Planets, Stardust, the Cosmos Tree
and ten World Laws with their Planet Traits.

**Numbers.** Every currency and every mote's Value is held as its logarithm (`js/num.js`), so
nothing has a cap and numbers grow past 10^308, shown as K … Dc, then aa, ab … zz, aaa, or in
scientific or engineering notation.

## Files

| File | What it is |
|------|------------|
| `js/data.js` | every table in the design, in one place |
| `js/num.js` | numbers with no ceiling, and their display |
| `js/state.js` | the one saved state, laid out by what resets it |
| `js/world.js` | plots grown from the seed, tiles, Rings, claiming |
| `js/econ.js` | every multiplier, cost and formula |
| `js/build.js` | placing, moving and removing copies; the layout cache |
| `js/sim.js` | the mote loop: Tracks, processors, Fusers, Hearths, Chimes, Rush |
| `js/events.js` | weather, Void tiles, meteors, critters |
| `js/goals.js` | Commissions, Moths, the Merchant, Feats, loot, secrets |
| `js/prestige.js` | Harvest, Eclipse, Genesis, the trees, the Sky, Trials |
| `js/auto.js` | Tinkers, Ghosts, Blueprints, Directives |
| `js/offline.js` | the catch-up while the game was closed, and the Time-lapse frames |
| `js/game.js` | one tick, and the wiring between systems |
| `js/render.js`, `js/models.js` | the 3D world and the contraption models |
| `js/ui.js`, `js/input.js` | panels, cards, toasts; touch, mouse and keys |
| `js/topics.js`, `js/info.js` | the long explanations behind each (i) |
| `js/update.js`, `sw.js` | the house auto-update pattern |

## Reused from elsewhere in this repository

- `js/rng.js` is Aeons' seeded randomness, line for line.
- `js/update.js`, `js/info.js`, `js/icons.js` and `sw.js` are Aeons' (which are Hacks', Magic
  Sandbox's and RouteCast's): the worker waits, answers `"skip-waiting"`, and `BW_VERSION` in
  `index.html` matches the cache name — `tools/validate.js` refuses to let them drift. Bumping
  it is what publishes an update.
- `vendor/build/three.module.min.js` and `vendor/jsm/utils/BufferGeometryUtils.js` are Hacks'
  copies; the post-processing passes under `vendor/jsm/` are from the same three.js release.

## Saving

The world saves to this browser's localStorage every 30 seconds and when the page is left, and
exports as a text code from the Menu. Nothing is sent anywhere.

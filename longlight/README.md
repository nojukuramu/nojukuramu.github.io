# The Long Light — a walk across Antarctica

Late summer on the coast. A man wakes in a base with nobody in it, and walks east along the old
flagged route, camp to camp, to the last station, lighting the beacons as he goes for whoever might
still be out there to see them. There are no enemies. There is food, warmth and fuel to keep, the
sun going round the sky and lower every turn, the wind, and what the people left behind them.

First person, in 3D with Three.js, on a coast generated from a seed. Plain ES modules, no build
step, no accounts, nothing sent anywhere. Plays offline once installed, with a mouse and keyboard,
a gamepad, or a phone held sideways.

## Running it

Serve the folder (`npx http-server longlight` or any static server) and open it.

| Check | Command |
|-------|---------|
| Static and behaviour checks (117) | `node tools/validate.js` (`--quick` for two coasts instead of eight) |
| The game in a real browser, WebGL included (47) | `node tools/e2e.js [--shots dir]` |

`validate.js` builds eight coasts and walks the route of every one, checks the sun, the meters and
each difficulty's rules, then lets an autopilot walk six whole journeys, base to East Cape, on
Easy, Normal and Hard, and prints how it did: about fifty minutes and nine kilometres each, and
the beacons at the base, every camp and the station lit.

## The design, and what came of it

| The design doc says | In The Long Light |
|---------------------|-------------------|
| Absence, not emptiness | Every camp is somebody's: bunks, a cold stove, the radio log of the week they left, a roster, a sledge abandoned half loaded, flags half buried. Fourteen things to find and read, each a few lines (`js/topics.js`). Nobody is ever met. |
| Gentle survival: food, warmth, fuel | Three meters, never shown as bars. Food drains slowly and faster when you hurry; warmth falls with wind, shade and the dark and comes back by a stove, a beacon or the sun; fuel feeds beacons, stoves and the lantern. Q (or the body button) says how you are, in words. |
| Optional everything | The route is flagged; the beacons, the detours (cairns to finish, lantern posts to light, a mast to raise, a radio to mend, holes in the sea ice to fish) are all yours to take or leave. |
| Hope hurts | A light seen once across the ice at dusk that is gone when you walk toward it; an engine in the sky that never comes; the radio's one song; at the station, an SOS in morse from nowhere. |
| Time felt, not shown | No clock. The sun is real solar geometry at 79° S: in late summer it circles the sky and never sets; as the walk goes on it dips to the horizon at midnight, then stays down. Shadows are the clock. |
| Footprints the wind drifts over | Every step leaves a print that fills in over minutes, faster in a strong wind; after a whiteout the tracks are gone. |
| Whiteouts | The wind lifts the snow, the world goes white and the sound goes to a roar; keep to the flags or wait it out. |
| Ice fields, sastrugi, crevasses, the frozen coast, open water | All generated (below). Sastrugi lie along the katabatic wind; the glacier is cracked across where it is pulled; sea ice has leads of black water and bergs frozen in. |
| Difficulty | Easy: slow drain, plenty lying about, a can a beacon, never ends the walk. Normal: slow drain, fair supplies, two cans a beacon; a blackout loses time and things. Hard: moderate drain, scarce supplies, three cans a beacon; a second blackout ends it. |
| Beacons | Nine: one on the rise above the base, one above each camp, two on hills between, and the station's. Hold E with enough fuel and one is lit for the rest of the walk, visible for kilometres in the dark. |
| The polar night, auroras | The last stretch is walked into the long night, under stars and an aurora. |
| Sparse music | Long stretches of nothing but wind. A few notes of piano now and then, more at a camp, a beacon and the end, generated and never the same twice; in the night a cello holds a low note under it. |
| Minimal UI | A crosshair, a one-line prompt, a one-line hint that fades. Everything else is behind a key: the pack, the route map, how you are. |
| Three acts, an open ending | Waking and the first beacon; the long walk east while the season turns; the night. At the station the last beacon is lit, and out over the sea, far off, one light answers. Who lit it is never said. |

## How it is built

| File | What it is |
|------|------------|
| [`js/world.js`](js/world.js) | the coast, from a seed: rock, ice sheet, glacier, sea ice and water, sastrugi and crevasses; the route, its five camps and the station, the beacons' hills, the flags. Pure, so Node builds it too |
| [`js/places.js`](js/places.js) | what people left: huts and what is in them, per site's role (bunkhouse, radio hut, mess, store, shed), the things to find, fuel and food by difficulty, flags, tents, sledges, masts, cairns, holes in the ice, the rare moments |
| [`js/sun.js`](js/sun.js) | where the sun is, for any hour and any point in the season, at 79° S |
| [`js/game.js`](js/game.js) | the rules: walking, the meters, the weather, blackouts, beacons, stoves, the radio, fishing, the ending. Pure, so the validator plays whole journeys in Node |
| [`js/worker.js`](js/worker.js), [`js/terrain.js`](js/terrain.js) | the land on screen: built once in a worker, then meshed in chunks by a pool of workers as a quadtree around you, finer near and coarser far; the surface shader (wind-packed snow, soft snow, rock, blue ice, sea ice, the glitter) |
| [`js/sky.js`](js/sky.js) | the sky: the Preetham model (three's `Sky`), twilight, the belt of Venus, the night, stars and aurora; and the same model in JavaScript, so the fog and the ambient light are the sky's colour |
| [`js/render.js`](js/render.js), [`js/scenery.js`](js/scenery.js) | the renderer, cascaded shadows, light from the sky, the post pass of cold; the huts, beacons, flags, footprints, drifting snow and smoke |
| [`js/textures.js`](js/textures.js) | what is drawn rather than downloaded: flame, glow, the boot print, canvas, flag cloth, smoke, snowflakes, ripples, slush |
| [`js/audio.js`](js/audio.js) | wind in layers and from its side, footsteps, the land cracking, fires where they burn, the radio, the generated music |
| [`js/input.js`](js/input.js) | keyboard and mouse (pointer lock), touch (a stick under the thumb, buttons under the other), gamepad |
| [`js/ui.js`](js/ui.js), [`js/topics.js`](js/topics.js) | the screens, the route map, the one-line hints and prompts, and every long explanation behind an (i) |
| [`js/main.js`](js/main.js) | the loop, journeys starting, saving and ending, the title scene, the service worker |
| `js/update.js`, `js/info.js`, `js/icons.js`, `js/rng.js`, `js/save.js`, `sw.js`, `vendor/` | lifted, see below |

**The land.** The usual, proven recipe for generated terrain, layered the way this coast is: rock
from Musgrave's ridged multifractal sampled through a Quilez domain warp, on Jonas Wagner's simplex
noise; weathered by Beyer's droplet hydraulic erosion (the method behind Sebastian Lague's widely
copied erosion: 140,000 drops on a 513² grid at 16 m) and a thermal (talus) pass. Then an ice sheet
rising from the coast, lowered where a glacier runs down to the sea, so rock shows only where it
stands above the ice. North of the coast, fast ice with pressure ridges and leads, open water, and
tabular bergs. Everything finer than 16 m (sastrugi, crevasses, the scour of blue ice) is a function
evaluated where it is asked for, so the mesh and a footprint agree. The route corridor and every
site are levelled into the land, and the validator walks the route of every coast it builds.

**The land on screen.** A chunked level-of-detail quadtree (Ulrich's chunked LOD): 64 m leaves of
65 × 65 vertices near you, 16 km roots at the horizon, children shown only when all four are built,
skirts to hide the seams. The chunks are meshed off the main thread by a pool of module workers
that each hold the world.

**The light.** The sun's direction drives everything: the sky, cascaded shadow maps (CSM) from it,
the fog and the hemisphere light coloured from the sky model, and the sky itself rendered into a
small cube and blurred (PMREM) as the environment every surface reflects. A post pass carries the
cold: colour drained, frost at the edges, a slow eye adaptation from the glare of noon to the night.

**Graphics and quality.** Two settings, apart. *Graphics* is how hard the card works: Fast (one
shadow cascade close round you, no sky reflections, no bloom), Normal (three cascades to half a
kilometre, the sky as environment, bloom) and Unrestrained (four cascades of 4096 to 1.8 km, so a
ridge's shadow reaches across the valley at a low sun; every pixel; multisampled edges; the sky's
light renewed every second). *Textures and models*: Packed is what ships in the offline install
(models simplified, textures at 256 to 1024 px, about 12 MB); Full quality fetches the originals
(unsimplified models, 1k model textures, 2k surfaces, about 35 MB from `assets/full/`) the first time
it is chosen and keeps them. Switching swaps the textures in place; nothing recompiles.

**Assets.** Models and surfaces are [Poly Haven](https://polyhaven.com) and
[ambientCG](https://ambientcg.com) (CC0), packed with glTF-Transform. See
[`assets/models/CREDITS.md`](assets/models/CREDITS.md) and
[`assets/textures/CREDITS.md`](assets/textures/CREDITS.md). Recordings are
[BigSoundBank](https://bigsoundbank.com)'s (CC0), cut and credited in
[`assets/sounds/CREDITS.md`](assets/sounds/CREDITS.md). The piano and cello are single notes from
Versilian's VSCO 2 Community Edition (CC0; the piano sampled by Simon Dalzell), credited in
[`assets/music/CREDITS.md`](assets/music/CREDITS.md). Everything plays a synthesised stand-in
until its file has loaded.

**Reused, not rewritten** (CLAUDE.md). Last Flame is the nearest thing in this repository, a
first-person 3D game on the same three, and most of the frame is its: `update.js`, `info.js`,
`sw.js` and `save.js` with the names changed; `icons.js`'s shape and general glyphs; `input.js`'s
pointer lock, touch stick and gamepad; `ui.js`'s screens and `main.js`'s loop; `render.js`'s
renderer setup and quality switch, its PBR material binding and the normal maps with height in
alpha; `scenery.js` keeps its accumulation and carving helpers; `textures.js` its flame and glow;
`audio.js` its whole shape (synthesised stand-ins, HRTF panners, beds that fade). Its floor
texture and five of its sounds are used unchanged. `rng.js` is Ballzooka's. `vendor/` is Last
Flame's three r160 and GLTFLoader, with three's own CSM and Sky add-ons of the same version, and
simplex-noise 4.0.3. Each lifted file names where it came from at the top, and the validator
checks that it still does.

**Auto-update.** The house pattern: the worker never calls `skipWaiting()` on install, answers
`"skip-waiting"` when the page asks, and the page checks on load, every 30 minutes, on return from
hidden and when the network comes back. A bar offers the reload; Settings shows the version and a
"Check for updates" button; a reload in the middle of a walk is confirmed first, and the walk carries on from where it was saved.
`window.LL_VERSION` in `index.html` and the worker's `longlight-v<N>` cache name are one number,
and the validator refuses to let them drift; bumping it is what publishes an update. The Full
quality files are kept in their own cache, outside the install, so an update never fetches them
again.

**Privacy.** Settings and the journey under way are in localStorage and nowhere else. No network
requests beyond the game's own files.

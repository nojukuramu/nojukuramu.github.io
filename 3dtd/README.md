# VELL — *the shallows remember*

A procedurally generated, grid-based **3D tower defense** on a drowned moor. Free camera,
mobile-friendly, no build step, no CDN — plain HTML/CSS/JS with a vendored copy of Three.js r128.

Play it at [`/3dtd/`](index.html).

---

## The world

Three hundred years ago the Foundry drained the moor of **Vell** to reach the ore beneath it, then
walked away and left the pumps running. The pumps failed. The water came back over the rails, the
kilns and the ledger-houses — and something in the warm dark underneath began to think.

You are the **Heartspore**: one colony, one mind, rooted at the centre of the shallows. The
**Bloom** is what you grow. The **Rust** — reactivated machine-remnants of the old foundries — walks
in from the flooded edges of the map to eat it.

The lore is not delivered in cutscenes. It is scattered across the terrain as **relics** — a leaning
pylon, a drowned bell, a faceless Warden effigy, an ore cart still warm, a vent that is still
breathing. Tap one in Inspect mode to read it; entries collect in the **Codex**.

## Environment

Every run generates a new moor from a random seed:

- **fBm + ridged value noise** heightmap, normalised so ~32% of the map falls below the waterline.
- Cells are classified into **ground** (buildable, walkable), **shallow water** (walkable, slows
  everything but Waders, traps may be laid in it), **deep water**, **cliff**, **prop** and the
  **Heartspore** / **spawn** pads.
- Groves, boulders, reeds, snags, glowing fungi and relics are scattered by density noise and
  **aligned to the terrain normal**, so everything lies flat on its slope.
- Before props are placed, an A* corridor from every spawn to the heart is **reserved**, so a map can
  never generate un-winnable.

## Rules

- **Towers** and **Walls** are solid. **Traps** lie flat in the path and are walked over.
- You may reshape the route freely, but you may **never seal it**: any placement that would leave a
  spawn (or a living enemy) with no path to the Heartspore is refused. Pathing is a Dijkstra flow
  field rebuilt from the heart on every change, and placement is validated against a scratch copy of
  it before the sap is spent.
- Blocked or stubborn enemies chew through walls and towers; Sappers seek them out on purpose.
- Every structure upgrades **forever**. Each **10th level** promotes it into a new form and you pick
  the branch. When the branches run out it **ascends** instead (Elder → Ancient → Primeval → …),
  multiplying every stat, without a ceiling.

### Upgrade trees

**The Bloom (towers)** — root: *Sporecap*

| Branch | Lv 10 | Lv 20 | Lv 30 | Lv 40 |
|---|---|---|---|---|
| thorn (single-target puncture) | Thornspire | Bramblelance / Ironbriar | Worldthorn / Sovereign Briar | ascension |
| mist (area, rot, slow) | Mistcap | Fogbloom / Rotmoor | Miasma Choir / Grave Lily | ascension |
| light (chain, beam) | Glowpod | Arcbloom / Stormcap | Aurora Crown / Solstice Beacon | ascension |

**The Weave (walkable traps)** — root: *Sporemat* → Tarvine (snare) / Emberpeat (burn) /
Wisplight (lure + vulnerability) → Snarelace · Gravebind · Cinderbog · Pyremoor · Beguiling Lantern ·
Hollow Choir → Deeproot Maw · Barrow Mouth · Ashen Fen · Pyre Heart · Lantern of Vell · Choir Eternal.

**The Bulwark (walls)** — Palisade → Heartwood Bulwark → Stonebound Wall → Petrified Gate.

### The Rust (enemies)

Rustling, Skitter, Slaghulk (armoured), Sapper (hunts structures), Wader (fast through the shallows),
Corrosite (repairs its neighbours) and the **Foundry Warden** boss every fifth wave.

## Controls

| | Touch | Mouse / keyboard |
|---|---|---|
| Pan | one-finger drag | left-drag, **WASD** |
| Orbit | two-finger twist | right-drag, **Q/E** |
| Tilt | two-finger slide up/down | **R/F** |
| Zoom | pinch | wheel, **+/−** |
| Build | tap to aim, tap again to confirm | hover + click |
| Shortcuts | — | **1/2/3** tools, **U** upgrade, **N** call wave, **C** codex, **Space** pause, **Esc** cancel |

## Presentation

- Splat-mapped terrain (moss / silt / stone by height and slope) injected into `MeshStandardMaterial`
  via `onBeforeCompile`, with wet-shore roughness and bioluminescent veins that only wake at night.
- **Water**: depth-shaded shallow→deep colour, scrolling ripple normals, Fresnel + sun specular,
  shoreline foam, night motes, and a real **planar reflection** (mirrored virtual camera into a render
  target) on high-quality devices.
- Full **day/night cycle** — sky-dome shader with sun disc, moon, stars and horizon palette
  keyframes; key light hands off from sun to moon; everything the Bloom grows glows after dark.
- Pooled additive/soft **particle systems** for every interaction: placement, promotion, muzzle
  flashes, impacts, splashes in the shallows, trap ticks, wall damage, deaths and bounties.
- All textures are generated procedurally on canvases at boot. All audio is **synthesised** with the
  Web Audio API — ambient wind/water/drone bed, day birds, night chorus, and every sound effect.
- Colour is authored in sRGB and converted to linear, with tone mapping and output encoding applied
  consistently across the custom shaders.

Quality (shadow maps, reflections, particle budget, pixel ratio, prop density) is auto-detected from
device memory, core count and form factor.

## Layout

```
3dtd/
├── index.html
├── css/style.css
├── vendor/three.min.js      # Three.js r128, vendored
└── js/
    ├── core.js              # namespace, math, noise, RNG, grid, event bus
    ├── textures.js          # procedural canvas textures
    ├── terrain.js           # heightmap, classification, splat-mapped mesh
    ├── path.js              # Dijkstra flow field + "you may not seal it" validation
    ├── water.js             # depth/Fresnel water + planar reflection
    ├── props.js             # groves, boulders, reeds, relics, night motes
    ├── sky.js               # sky dome, sun/moon, day-night lighting
    ├── fx.js                # pooled particles, rings, beams
    ├── defs.js              # towers, traps, walls, enemies, waves, story
    ├── audio.js             # Web Audio synthesis
    ├── build.js             # placement, promotion, firing, the Heartspore
    ├── enemies.js           # spawning, flow-field marching, status effects
    ├── input.js             # free camera + picking
    ├── ui.js                # HUD, panels, codex, toasts
    └── main.js              # bootstrap and game loop
```

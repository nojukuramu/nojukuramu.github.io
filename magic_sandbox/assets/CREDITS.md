# Asset Credits — Magic Sandbox: The Loom Tower

All 3D models shipped in `assets/models/` are **CC0** (public domain, no attribution
required). Sources and per-asset authorship are listed below for transparency.

## pmndrs/market-assets (https://github.com/pmndrs/market-assets)

These models were sourced as Draco-compressed embedded glTF (`model.gltf`) from the
`files/models/<name>/` folders of the repo. Each asset's `info.json` carries a numeric
`license` field; the mapping (confirmed from `pmndrs/market`'s
`src/helpers/constants/licenses.js`) is `1 = CC0`, `2 = CC-BY`. Every asset used here
had `"license": 1`, i.e. **CC0**. The Draco geometry was decoded locally (DracoPy) and
re-exported as plain (non-Draco) glTF-binary so the game's vendored `GLTFLoader` does
not need a Draco decoder.

| File | Market-assets name | Author (per info.json) | License |
|---|---|---|---|
| `tree-a.glb` | Low Poly Tree | saravieira | CC0 |
| `tree-b.glb` | Tree (tall pine) | Kenney | CC0 |
| `tree-pine-a.glb` | Tree (short pine) | Kenney | CC0 |
| `rock-a.glb` | Foundation Rock | Kenney | CC0 |
| `rock-b.glb` | Foundation Stone | Kenney | CC0 |
| `rock-c.glb` | Foundation Large Rock | Kenney | CC0 |
| `rock-large.glb` | Foundation Large Stone | Kenney | CC0 |
| `lava-rock.glb` | Foundation Large Rock (reused for Ember theme) | Kenney | CC0 |
| `chest.glb` | Cannon Chest | Kenney | CC0 |
| `pillar.glb` | Tower (crenellated watchtower/turret) | Kenney | CC0 |
| `mushroom-a.glb` | Mushroom | Kenney | CC0 |
| `mushroom-b.glb` | Mushroom Half | Kenney | CC0 |
| `player-mage.glb` | Pirate Captain | Kenney | CC0 |
| `enemy-brute.glb` | Pirate Officer | Kenney | CC0 |
| `enemy-boss.glb` | Pirate Crew | Kenney | CC0 |
| `table.glb` | Table | saravieira | CC0 |
| `enemy-rusher.glb` | Zombie (variant 1) | Kenney | CC0 |
| `enemy-swarmer.glb` | Zombie (variant 2) | Kenney | CC0 |
| `enemy-caster.glb` | Female Cyborg | Kenney | CC0 |

**Round 2 characters -- repose note:** `enemy-rusher.glb`, `enemy-swarmer.glb`, and
`enemy-caster.glb` come from a 60-node Mixamo-style skinned rig shared by market-assets'
whole "characters" family, shipped upstream with **zero baked animation clips** (the bind
pose is a full T-pose, arms straight out to the sides). Shipping that as a static mesh
would render as a stiff scarecrow in-game, so a custom script
(`repose.py`/`decode2.py`, not included in the repo -- scratchpad tooling) performed full
linear-blend skinning to bake a relaxed arms-down idle pose (shoulders rotated ~75°
about the world Z axis at the shoulder joint's bind-pose pivot, blended per-vertex using
the source's own joint weights and inverse-bind matrices), then dropped the skin/joints
entirely. The shipped GLBs have **no skin, no joints, no animations** -- they are fully
static meshes, verified by scanning each file's JSON chunk for a `skins` array (absent
in all three).

**Round 2 characters -- role substitution honesty:** none of the reachable CC0 sources
had a robed/wizard humanoid, a non-humanoid tiny critter (slime/bee/spider/bat), or a
distinctly "bulky ogre/golem-shaped" body mesh. `player-mage`, `enemy-brute`, and
`enemy-boss` reuse the three color/headwear variants of market-assets' blocky "pirate"
family (captain/officer/crew) as the closest available stand-ins; `enemy-swarmer` reuses
the same rig/pose as `enemy-rusher` with a different skin (zombie variant 2) rather than
being left unfilled, since no true tiny-critter asset could be found. See
`curator2-report.md` for the full reasoning and what was rejected (a CC0 Dragon and a CC0
"Coronavirus" model were both tried for `enemy-boss`/`enemy-swarmer` but rejected: their
source meshes were 100k-350k triangles / 7-9 MB each, and mesh decimation via
`fast-simplification` produced broken/degenerate geometry at any size that would fit the
budget).

## Kenney.nl (via KenneyNL GitHub Starter Kits)

Sourced by shallow-cloning `github.com/KenneyNL/Starter-Kit-3D-Platformer`,
`Starter-Kit-City-Builder`, and `Starter-Kit-FPS`. Each kit's `README.md` states
explicitly: *"Sprites and 3D Models (CC0 licensed)"* and *"Assets included in this
package (2D sprites, 3D models and sound effects) are CC0 licensed"*. The repos'
`LICENSE.md` (MIT) covers the accompanying starter-kit code; the art assets themselves
are Kenney's standard CC0 release. All are copied unmodified.

| File | Source kit / original filename | License |
|---|---|---|
| `banner.glb` | Starter-Kit-3D-Platformer / `flag.glb` | CC0 |
| `grass-a.glb` | Starter-Kit-3D-Platformer / `grass-small.glb` | CC0 |
| `grass-b.glb` | Starter-Kit-3D-Platformer / `grass.glb` | CC0 |
| `shrine.glb` | Starter-Kit-City-Builder / `pavement-fountain.glb` | CC0 |
| `barricade.glb` | Starter-Kit-FPS / `wall-low.glb` | CC0 |
| `ruin-wall.glb` | Starter-Kit-FPS / `wall-high.glb` | CC0 |

All Kenney assets by Kenney Vleugels (kenney.nl).

## three.js (vendor/)

`vendor/build/three.module.min.js`, `vendor/examples/jsm/loaders/GLTFLoader.js`, and
`vendor/examples/jsm/utils/BufferGeometryUtils.js` are three.js r160.1, MIT licensed.
Full license text: `vendor/LICENSE-three.txt`.

## Ground textures (`assets/textures/`, round 2) -- sourced from mrdoob/three.js

`mrdoob/three.js` is MIT licensed overall, but several of its example texture
subfolders carry their own more-specific per-asset license via a `readme.txt`
(the standard three.js convention) -- those are recorded precisely below rather than
defaulting to the blanket repo MIT.

| File | Source (in three.js repo) | License | Author / provenance |
|---|---|---|---|
| `ground-grass.png` | `examples/textures/terrain/grasslight-big.jpg` | **CC BY 3.0** | Per `examples/textures/terrain/readme.txt`: sourced from opengameart.org/content/dark-grass, "Licensed under a Creative Commons Attribution 3.0 Unported License" |
| `ground-snow.png` | `examples/textures/ambientcg/Ice002_1K-JPG_Color.jpg` | **CC0** | ambientCG (ambientcg.com) -- ambientCG's entire catalog is published CC0 1.0 Universal; three.js mirrors this file verbatim in a folder literally named `ambientcg` |
| `ground-lava.png` | `examples/textures/lava/lavatile.jpg` | MIT (repo-level) | three.js authors -- no per-file readme.txt exists for this one (unlike `terrain/` and `cube/*`), so it falls back to the repository's overall MIT license, which the task brief pre-approved for three.js sources |
| `ground-stone.png` | `examples/textures/brick_diffuse.jpg` | MIT (repo-level) | three.js authors -- same no-readme caveat as lava; this is a brick-wall photo (no natural rock/stone CC0 texture was found anywhere reachable), reads as a flagstone floor after processing |
| `ground-void.png` | `examples/textures/tri_pattern.jpg` | MIT (repo-level) | three.js authors -- abstract geometric triangle-grid pattern, same no-readme caveat |

All five were converted to 256x256 grayscale-luminance PNGs, brightness-normalized to a
mean of ~135-138 (tint-friendly for the game's per-theme color multiply), and verified
for seamless tiling with an offset-by-half edge-gradient test. `ground-stone.png`
originally had a visible seam (brick coursing doesn't crop-tile cleanly); it was fixed
with a roll-by-half + localized-blur "heal" at the new center seam. Total texture
payload: **~238 KB** (budget was 1.5 MB).

Two other candidate sources were investigated for ground textures and rejected/skipped:
Kenney and Screaming Brain Studios "Tiny Texture Pack" GitHub repos were probed under
~10 guessed org/repo name variants each (`git ls-remote`) and none resolved (no public
mirror could be found); `examples/textures/minecraft/*` in the three.js repo exists but
its `painterlypack.txt` points to painterlypack.net, whose license has historically
included non-commercial/attribution restrictions in some releases, so it was not used
out of caution. Poly Haven, ambientCG's own site/API, OpenGameArt, and kenney.nl were
all unreachable (proxy 403), consistent with the known network policy.

## Summary

- Total models shipped: 26 (19 from round 1 + 7 new in round 2)
- Round 2 new model bytes: ~603 KB (budget was 3 MB)
- Round 2 new texture bytes: ~238 KB (budget was 1.5 MB)
- License: predominantly CC0. Round 2 added 1 CC-BY-3.0 texture (`ground-grass.png`,
  attributed above) and 3 MIT-licensed textures (three.js repo-level, no per-file
  readme.txt); everything else (all round-2 models) is CC0. No attribution is legally
  required for the CC0 assets, but authorship is recorded above for provenance; the
  CC-BY-3.0 asset's attribution above satisfies its license requirement.

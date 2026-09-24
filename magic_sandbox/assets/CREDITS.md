# Asset Credits — Magic Sandbox: The Loom Tower

All 3D models shipped in `assets/models/` are **CC0** (public domain, no attribution
required). Sources and per-asset authorship are listed below for transparency.

## What ships in version 2

Version 2 keeps the environment models that read well from above — Kenney's
rocks, pines, mushrooms and bushes, the chest, the fountain and the watchtower —
and retires every character model. The first version dressed its mage and its
enemies in recoloured CC0 pirates, zombies and a cyborg because no CC0 wizard or
creature set could be found; they never looked like one world. The mage, every
enemy, the Wardens, the Loom Heart, the Anchors, the portal and the geodes are
now built from primitives in code (`js/models.js`), as are the broadleaf trees,
crystals, ruined columns, ice spikes and grass tufts (`js/world.js`). Every
sound is synthesised (`js/audio.js`); there are no audio files.

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
| `tree-b.glb` | Tree (tall pine) | Kenney | CC0 |
| `tree-pine-a.glb` | Tree (short pine) | Kenney | CC0 |
| `rock-a.glb` | Foundation Rock | Kenney | CC0 |
| `rock-b.glb` | Foundation Stone | Kenney | CC0 |
| `rock-c.glb` | Foundation Large Rock | Kenney | CC0 |
| `rock-large.glb` | Foundation Large Stone | Kenney | CC0 |
| `chest.glb` | Cannon Chest | Kenney | CC0 |
| `pillar.glb` | Tower (crenellated watchtower/turret) | Kenney | CC0 |
| `mushroom-a.glb` | Mushroom | Kenney | CC0 |
| `mushroom-b.glb` | Mushroom Half | Kenney | CC0 |

## Kenney.nl (via KenneyNL GitHub Starter Kits)

Sourced by shallow-cloning `github.com/KenneyNL/Starter-Kit-3D-Platformer` and
`Starter-Kit-City-Builder`. Each kit's `README.md` states explicitly: *"Assets included
in this package (2D sprites, 3D models and sound effects) are CC0 licensed"*. The repos'
`LICENSE.md` (MIT) covers the accompanying starter-kit code; the art assets themselves
are Kenney's standard CC0 release. All are copied unmodified.

| File | Source kit / original filename | License |
|---|---|---|
| `grass-a.glb` | Starter-Kit-3D-Platformer / `grass-small.glb` | CC0 |
| `grass-b.glb` | Starter-Kit-3D-Platformer / `grass.glb` | CC0 |
| `shrine.glb` | Starter-Kit-City-Builder / `pavement-fountain.glb` | CC0 |

All Kenney assets by Kenney Vleugels (kenney.nl).

Retired in version 2 (removed from the repository, recorded here for provenance):
`player-mage`, `enemy-brute`, `enemy-boss` (pmndrs pirates, Kenney, CC0), `enemy-rusher`,
`enemy-swarmer`, `enemy-caster` (pmndrs characters, Kenney, CC0), `tree-a` and `table`
(pmndrs, saravieira, CC0), `lava-rock` (a duplicate of `rock-c`), and `banner`,
`barricade`, `ruin-wall` (Kenney starter kits, CC0).

## three.js (vendor/)

`vendor/build/three.module.min.js`, `vendor/examples/jsm/loaders/GLTFLoader.js`,
`vendor/examples/jsm/utils/BufferGeometryUtils.js`, and — new in version 2, for the
bloom on High graphics — `vendor/examples/jsm/postprocessing/` (EffectComposer,
RenderPass, UnrealBloomPass, OutputPass, ShaderPass, MaskPass, Pass) with the shaders
they need in `vendor/examples/jsm/shaders/` (CopyShader, LuminosityHighPassShader,
OutputShader) are three.js r160, MIT licensed, copied unmodified from the `three@0.160.0`
npm package. Full license text: `vendor/LICENSE-three.txt`.

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

- Models shipped: 13, all CC0 (about 0.3 MB). Twelve earlier models were retired in
  version 2; see above.
- Textures: 5 ground detail tiles (~238 KB): one CC-BY-3.0 (`ground-grass.png`,
  attributed above), one CC0, three MIT (three.js repository).
- Characters, effects and sound: made in code, no assets.

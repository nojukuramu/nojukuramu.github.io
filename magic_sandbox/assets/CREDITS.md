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

## Summary

- Total models shipped: 19
- Total bytes: ~433 KB (budget was 4.5 MB)
- License: 100% CC0. No CC-BY assets were used; no attribution is legally required,
  but authorship is recorded above for provenance.

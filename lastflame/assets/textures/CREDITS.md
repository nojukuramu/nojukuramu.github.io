# Surfaces

Every surface here is a [Poly Haven](https://polyhaven.com) texture, public domain under CC0 1.0.
Each is the 1k JPEG set — colour, OpenGL normal, and ARM (ambient occlusion in red, roughness in
green) — resized (the floor and plaster colour to 1024, the rest to 512 or 256) and re-encoded as
WebP.

`original/` holds the same textures for the Original texture setting, not shrunk: the 2k JPEG
colour and normal and the 1k ARM, re-encoded as WebP and named as the shipped files are. They are
not in the offline install; the game fetches them the first time Original is chosen.

| Files | Poly Haven texture |
|-------|--------------------|
| `floor` (`floor.webp`, `floor_n.webp`, `floor_arm.webp`) | [old_wooden_floor_02](https://polyhaven.com/a/old_wooden_floor_02) |
| `plaster` (`plaster.webp`, `plaster_n.webp`, `plaster_arm.webp`) | [worn_plaster_wall](https://polyhaven.com/a/worn_plaster_wall) |
| `panels` (`panels.webp`, `panels_n.webp`, `panels_arm.webp`) | [wooden_panels](https://polyhaven.com/a/wooden_panels) |
| `ceiling` (`ceiling.webp`, `ceiling_n.webp`, `ceiling_arm.webp`) | [wood_planks](https://polyhaven.com/a/wood_planks) |
| `tiles` (`tiles.webp`, `tiles_n.webp`, `tiles_arm.webp`) | [patterned_terracotta_tiling](https://polyhaven.com/a/patterned_terracotta_tiling) |
| `cabinet` (`cabinet.webp`, `cabinet_n.webp`, `cabinet_arm.webp`) | [wood_cabinet_worn_long](https://polyhaven.com/a/wood_cabinet_worn_long) |
| `damaged` (`damaged.webp`, `damaged_n.webp`, `damaged_arm.webp`) | [damaged_plaster](https://polyhaven.com/a/damaged_plaster) |

The capiz panes, the calado fretwork, the paper of the notes, the creature's face, skin, hair
and dress are drawn in code (`js/textures.js`).

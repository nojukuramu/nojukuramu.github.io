# Surfaces

Every surface here is public domain under CC0 1.0: Poly Haven textures and ambientCG materials.

Each name is three files: the colour (`<name>.webp`), the OpenGL normal (`<name>_n.webp`) and the
ARM map (`<name>_arm.webp`: ambient occlusion in red, roughness in green, metalness in blue). Each
normal map carries the surface's height in its alpha, the source's displacement map stretched to
fill the range and kept between half and full alpha, for the parallax that gives the snow, rock
and hut walls their depth. That is the same packing as Last Flame's surfaces, so the shader
patches read the same in both. ambientCG ships no ARM map; it is built from the material's
ambient occlusion (or white, where it has none) and roughness, with no metal.

The packed set, the one the offline install keeps, is resized to 512 or 1024 px (the ARM map to
half that) and re-encoded as WebP. `../full/textures/` holds the same surfaces under the same names
for the Full quality setting: the 2k colour and normal and a 1k ARM. They are not in the offline
install; the game fetches them the first time Full is chosen.

| Files | Source | Author |
|-------|--------|--------|
| `snow_wind` (`snow_wind.webp`, `snow_wind_n.webp`, `snow_wind_arm.webp`) | [Snow008A](https://ambientcg.com/view?id=Snow008A), ambientCG | Lennart Demes |
| `snow_soft` (`snow_soft.webp`, `snow_soft_n.webp`, `snow_soft_arm.webp`) | [Snow010A](https://ambientcg.com/view?id=Snow010A), ambientCG | Lennart Demes |
| `snow_aerial` (`snow_aerial.webp`, `snow_aerial_n.webp`, `snow_aerial_arm.webp`) | [Snow Field Aerial](https://polyhaven.com/a/snow_field_aerial), Poly Haven | Rob Tuytel |
| `rock` (`rock.webp`, `rock_n.webp`, `rock_arm.webp`) | [Dark Rock](https://polyhaven.com/a/dark_rock), Poly Haven | Amal Kumar |
| `ice` (`ice.webp`, `ice_n.webp`, `ice_arm.webp`) | [Ice003](https://ambientcg.com/view?id=Ice003), ambientCG | Lennart Demes |
| `hut_red` (`hut_red.webp`, `hut_red_n.webp`, `hut_red_arm.webp`) | [Box Profile Metal Sheet](https://polyhaven.com/a/box_profile_metal_sheet), Poly Haven | Amal Kumar |
| `hut_grey` (`hut_grey.webp`, `hut_grey_n.webp`, `hut_grey_arm.webp`) | [Corrugated Iron 02](https://polyhaven.com/a/corrugated_iron_02), Poly Haven | Jenelle van Heerden, Sergej Majboroda |
| `planks` (`planks.webp`, `planks_n.webp`, `planks_arm.webp`) | [Weathered Planks](https://polyhaven.com/a/weathered_planks), Poly Haven | Dario Barresi, Dimitrios Savva |
| `floor` (`floor.webp`, `floor_n.webp`, `floor_arm.webp`) | [Old Wooden Floor 02](https://polyhaven.com/a/old_wooden_floor_02), Poly Haven; Last Flame's `floor`, unchanged (`lastflame/assets/textures/`) | Charlotte Baglioni, Jenelle van Heerden |
| `metal` (`metal.webp`, `metal_n.webp`, `metal_arm.webp`) | [Rusty Metal Sheet](https://polyhaven.com/a/rusty_metal_sheet), Poly Haven | Amal Kumar |

The flame, the glow, the boot print, the canvas of the tents, the flag cloth, smoke, snowflakes,
the ripples on open water and the slush in a fishing hole are drawn in code (`js/textures.js`).
The sky is computed, not a picture (`js/sky.js`).

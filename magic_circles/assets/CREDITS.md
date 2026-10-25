# Asset credits — Magic Circles

Every model in `assets/models/` is **Kenney**'s (Kenney Vleugels, [kenney.nl](https://kenney.nl)),
released under **CC0 1.0** (public domain): free to use, no attribution required. Each kit's
`License.txt` says so in as many words. They are credited here anyway, gladly.

The Phaser build's eighteen hand-made PNG sprites (`static/assets/`) are retired with it.

| Folder | Kit | Downloaded from | What it is in the game |
|---|---|---|---|
| `models/nature` | Nature Kit (2020) | kenney.nl/assets/nature-kit — the `GLTF format` folder, `.glb` files | trees, cacti and palms, rocks and cliffs, grass, flowers, mushrooms, lilies, logs, tents, the waystone's obelisk, ruined columns |
| `models/town` | Fantasy Town Kit 2.0 | kenney.nl/assets/fantasy-town-kit | village walls (wood), the plaza fountain, market stalls, carts, lanterns, stairs, round trees |
| `models/grave` | Graveyard Kit 5.0 | kenney.nl/assets/graveyard-kit | stone walls, gravestones, crypts, candles, the courtyard altar and pillars, crooked pines; **the skeleton, zombie, vampire, ghost and keeper** that are the Hexers, Prowlers, Wisps and three of the Wardens |
| `models/castle` | Castle Kit | kenney.nl/assets/castle-kit | fortress walls, the fortress keep and the mage tower (stacked tower pieces), stone stairs |
| `models/survival` | Survival Kit | kenney.nl/assets/survival-kit | crates, barrels, chests, campfires, desert rocks |
| `models/dungeon` | Mini Dungeon | kenney.nl/assets/mini-dungeon | **the orc** that is the Brute and the Verdant Warden, potions |
| `models/people` | Mini Characters | kenney.nl/assets/mini-characters | **the mage**: four of the twelve, in a hat and with a staff made in `js/player.js` |

The `.glb` files are copied unmodified, with each textured kit's `Textures/colormap.png` beside
them (the files reference it by that relative path). `tools/manifest.js` reads their bounds into
`assets/manifest.json`; `tools/validate.js` checks that the folder, the manifest and the code agree.

The characters of the Graveyard, Mini Dungeon and Mini Characters kits share one rig and one set
of animations (idle, walk, sprint, die, holding-right-shoot, attack-melee-right …), which is why
one loader drives all of them.

Everything else is made in code: the ground, roads, floors and water (`js/terrain.js`,
`js/textures.js`), the mage's hat and staff, the spells, the Wardens' crowns, every sound
(`js/audio.js`, synthesised), and the renderer is three.js r160 (`vendor/`, MIT, see
`vendor/LICENSE-three.txt`), vendored from Magic Sandbox, with three's `SkeletonUtils` of the
same version added for the skinned Mini Characters.

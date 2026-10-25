# Magic Circles — A Certain RPG

Draw your own spells and walk a world that never ends. A spell is a drawing, not a menu
choice: trace elemental glyphs through a ring of twelve dots, wrap them in seals, notch the
seals with runes, stack pages into payloads. Then take what you drew out into a seeded,
endless land of forests, deserts, ruins and lakes, joined by roads with a waystone at every
crossing, and take the Sigils from the Wardens of its great places.

2.5D in three.js: played on the ground plane, drawn in depth under a sun that goes round.
Plain ES modules, no build step, no accounts, nothing sent anywhere. Plays offline once
installed, with a mouse and keyboard, a gamepad, or a phone held either way up.

## Running it

Serve the folder (`npx http-server magic_circles`, `python3 -m http.server`, any static
server) and open it. Not over `file://`: the models are fetched.

| Check | Command |
|-------|---------|
| Static and behaviour checks | `node tools/validate.js` |
| The game in a real browser, WebGL included | `node tools/e2e.js [--shots dir]` |
| Rewrite `assets/manifest.json` after adding a model | `node tools/manifest.js` |

## The game

**The world.** Grown from a seed you can type or leave to chance: the same seed is the same
world on every device. Twelve biomes, from the Phaser build's table and with its rarities —
Plains and Forest the commonest, Graveyards and Camps the rarest — laid out as regions that
grow round jittered sites with borders bent by noise, small patches (Ruins, Villages,
Graveyards, Camps, Caves) set on top. Every chunk is one of the Phaser build's 8 × 8 preset
grids, chosen as it always was: a road passing through wins, then the biome's own presets by
rarity. Lakes and swamps hold water you wade through slowly.

**Roads and waystones.** Every 10 × 10 chunks has a hub; hubs join their neighbours most of
the time, and a road runs out, across and in. A waystone stands on every hub. Step onto one
and it is yours: it heals you and refills your mana while you stand there, you wake there if
you fall, and from the map you can step to any waystone you hold.

**Structures.** The nine multi-chunk structures the Phaser build defined and never placed —
fortress, mage tower, plaza, courtyard, market row, hamlet, long bridge, old grove, still
lake — are placed, at most one in every 6 × 6 chunks, never across a road, dressed with what
belongs there (stalls and banners, crypts and iron fences, tents and palisades). The four
great ones each have a tower or a fountain or an altar at their centre, and a Warden.

**Danger.** Everything is stronger the further you are from where you began — one step every
150 m — so a road out is a choice of how hard you want it.

**Wardens and Sigils.** The Phaser build's four bosses, each with its one trick, now marked on
the ground before it lands: the Verdant Warden heals itself, the Ashfall Tyrant sets the
ground under you burning, the Depths Harbinger steps through to behind you, the Void Sentinel
unmakes your next spell. Each drops a Sigil; a Sigil raises your circle rank, and rank is how
much a page may hold. Walk away from a Warden and it goes back to sleep, and mends.

**The others.** The Phaser build's three archetypes and one more: the Prowler closes and
lunges, the Brute slams the ground, the Hexer keeps its distance and casts, the Wisp flits in.
Every attack shows itself first; a dash passes through.

**Growing.** Experience from everything you beat; each level is more health and deeper pools.
Chests in the lesser structures hold potions. Crates and barrels break, and sometimes hold
mana or health.

**The day.** Fourteen minutes from dawn to dawn. The light warms at dusk and goes blue at night,
the fog is always the sky's colour, and the mage's staff glows brighter in the dark.

## The magic-circle system

All of it is in [`js/spellcore.js`](js/spellcore.js), pure and tested in Node. The page is
Magic Sandbox's (the two games share a drawing format); what the drawing means is this game's.

| Mark | How | Means |
|------|-----|-------|
| Glyph | a closed shape through the ring's twelve dots | its sides are its element: 3 **Air**, 4 **Fire**, 5 **Earth**, 6 **Water**. Every glyph is fuel: damage, power, and mana from its element's own pool |
| Seal | drag out a circle | on the first layer, something you throw; where it sits is where it leaves from |
| Rune | tap a seal's rim | one shot in that direction; the top of the page is where you aim |
| Layer | add a page | bursts out of every shot of the layer above when you pull the trigger (right click), or when the shot runs out |
| Power | the slider, ×1 to ×10 | pushes every seal toward the piercing end of the spectrum and reaches further; 20% more mana a step |

**Predators.** Glyphs are read bottom to top, layer by layer, onto a stack:
**Water ▸ Fire ▸ Earth ▸ Air ▸ Water**. A glyph that preys on the one just below it
annihilates with it; both are lost and their mana is still spent. Draw Fire then Earth and you
have both; Earth then Fire and you have nothing. The Phaser build did this silently; the page
now draws a lost glyph dashed and the readout says what ate what.

**The spectrum.** A seal's power divided by its radius decides what it throws:

| Spectrum | Behaviour |
|----------|-----------|
| Needle, Lance, Beam | sharp: fast, pass through four, three, two |
| Dart | a plain throw |
| Wave | a wide crescent that sweeps through everything once |
| Burst, Cannon | blow up where they stop |
| Boulder | slow and heavy; carries what it hits ahead of it |
| Nova | a huge seal with a lot of power: erupts where it sits |
| Flicker | too little power for its circle |

Power is 50 plus 25 for every glyph that survives the stack, times the page's power. While you
size a seal, a dashed ring marks each radius where the spectrum changes. A payload inherits its
parent's power, so its seals are judged again: a slow Cannon can burst into Needles.

**Elements.** Fire burns, Water slows, Air throws and reaches further, Earth shoves and adds a
pierce. Blunt shots push crates, barrels and rocks by the ratio of their power to the thing's
mass; walls and cliffs stop everything.

**Tier.** The whole page is scored (SpellTier.js's formula, kept): power × the spectrum's
ceiling × element diversity × payload layers × multishot × balance. The score is a tier, E to
SSS, and each tier adds 0.4 s to the staff's one shared cooldown and a quarter more mana.

**Balance.** A page that mirrors left to right flies true; a lopsided one scatters and loses up
to half its power and damage. (The Phaser build also swapped elements at random on an unstable
page; that is gone, because a spell that sometimes becomes another cannot be learned.)

**Mana.** Four pools, refilling at their own pace — Air quickest, Earth slowest. A page you can
partly pay for goes without the glyphs you cannot afford; one you cannot pay for at all throws
the grey bolt. Each scroll's dot says which: green, yellow, red.

**Circle rank** (1–6): glyphs, seals, runes, layers, power and shots a page may hold. A page
beyond your rank waits for you; nothing on it is lost.

**Eight scrolls**, as before, kept between sessions with the journey you are on.

## Controls

| | Move | Aim / cast | Dash | Payload | Scrolls | Potion | Spellbook | Map | Pause |
|---|---|---|---|---|---|---|---|---|---|
| Keyboard & mouse | W A S D | mouse, hold left click | Space, Shift | right click, F | 1–8, wheel | Q | M, B, Tab | N | Esc |
| Touch | left thumb | right thumb (hold still: aims for you) | Dash | the glowing button | tap one | the flask | the book | the map | pause |
| Gamepad | left stick | right stick, RT | A | LT | LB / RB | Y | Back | B | Start |

## Files

| File | What it is |
|------|------------|
| [`js/world.js`](js/world.js) | the seeded world as data: biomes, roads and waystones, structures, water, danger, every chunk's objects, floors and creatures. Pure, so Node builds it |
| [`js/presets.js`](js/presets.js) | the Phaser build's 8 × 8 chunk presets, structures and structure parts, ported unchanged in content |
| [`js/spellcore.js`](js/spellcore.js) | what a drawing means — the whole grammar. Pure |
| [`js/forge.js`](js/forge.js), [`js/glyphart.js`](js/glyphart.js) | the spellbook, and the routine that draws a page anywhere |
| [`js/terrain.js`](js/terrain.js), [`js/textures.js`](js/textures.js) | the ground of a chunk — soil, roads, floors, water, what grows — and the canvases they are painted with |
| [`js/chunks.js`](js/chunks.js) | the world near you, built as you walk: models, colliders, waystones, chests, towers, dressing |
| [`js/assets.js`](js/assets.js) | Kenney's models, loaded once: props through instanced pools, characters through one rig |
| [`js/physics.js`](js/physics.js) | circles and walls on the ground plane, pushing by mass, swept shots |
| [`js/player.js`](js/player.js), [`js/spells.js`](js/spells.js), [`js/enemies.js`](js/enemies.js) | the mage; shots, blasts, payloads; the creatures and the Wardens |
| [`js/game.js`](js/game.js) | the journey: packs, pickups, waystones, chests, Sigils, falling, the compass, saving |
| [`js/gfx.js`](js/gfx.js), [`js/fx.js`](js/fx.js) | renderer, camera, the day, quality tiers; pooled particles, rings, warnings |
| [`js/hud.js`](js/hud.js), [`js/map.js`](js/map.js), [`js/menus.js`](js/menus.js), [`js/input.js`](js/input.js) | what is on screen, the map, every screen, every device |
| [`js/audio.js`](js/audio.js) | synthesised sound, and music that follows the land and the hour |
| [`js/info.js`](js/info.js), [`js/topics.js`](js/topics.js), [`js/update.js`](js/update.js), [`js/save.js`](js/save.js), [`js/state.js`](js/state.js), [`js/icons.js`](js/icons.js), [`js/util.js`](js/util.js) | the (i) sheet and every long explanation, the update prompt, the one localStorage record, the event bus, the glyphs, the small maths |

## Reused, not rewritten

Magic Sandbox is the nearest thing in this repository — the same idea, drawn spells in a 3D
top-down game on the same three — and most of the frame is its, each file naming where it came
from at the top (the validator checks that it still does): `gfx.js`'s renderer, quality tiers
and tilted camera; `fx.js` whole; `input.js`'s floating sticks and gamepad; `forge.js` and
`glyphart.js`, the spellbook and its drawing, with the readout and preview pointed at this
game's rules; `audio.js`'s synthesis; `hud.js`, `menus.js`, `main.js`, `save.js` and
`state.js` in shape; `game.css`; `sw.js` and `update.js` (RouteCast's, by way of Magic
Sandbox); `icons.js`. `info.js` is Last Flame's, with the long copy in `topics.js` as Last
Flame and The Long Light keep it. `vendor/` is Magic Sandbox's three r160, with three's own
`SkeletonUtils` of the same version added for the skinned characters.

What is this game's own and was kept from the Phaser build: the world's presets and its
chunk → preset rules (`ChunkPresets.js`, `ChunkManager.js`, `PathwayRenderer.js`); the
biomes and their rarities; the spell grammar — elements by sides, the predator stack, the
spectrum by power over radius, power ×1–×10, SpellTier's score and tiers, four element pools,
eight scrolls, payloads on the trigger, spells clashing by power, blunt shots pushing by mass;
the three archetypes and four bosses with their gimmicks. Rebuilt: everything that drew it, and
the walled-arena "floors" the Phaser build had last become, which left the endless world unused.

## Assets

Every model is Kenney's (CC0): the Nature, Fantasy Town, Graveyard, Castle, Survival, Mini
Dungeon and Mini Characters kits — see [`assets/CREDITS.md`](assets/CREDITS.md). They replace
the Phaser build's eighteen hand-drawn sprites. Everything else is drawn or synthesised in code.

## Auto-update

The house pattern (CLAUDE.md): the worker never calls `skipWaiting()` on install, answers
`"skip-waiting"` when the page asks, and the page checks on load, every 30 minutes, on return
from hidden and when the network comes back. A bar offers the reload; Settings shows the version
and a "Check for updates" button; a reload in the middle of a fight is confirmed first, and the
journey carries on from where it was saved. `window.MC_VERSION` in `index.html` and the worker's
`mcircles-v<N>` cache are one number, and the validator refuses to let them drift — bumping it
is what publishes an update. `phaser.html`, where the Phaser build lived and where installed
copies still open, sends you on to the game.

## Privacy

Your scrolls, your settings and the journey you are on are in this browser's localStorage and
nowhere else. No network requests beyond the game's own files.

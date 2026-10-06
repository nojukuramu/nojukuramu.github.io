# Aeons — an endless real-time strategy, from the first fire to the age of aether

A real-time strategy game in the old style — gather, build, train, research, fight across a map
you cannot see until you send someone to look — with one difference: there is no last battle.
Touch first, played sideways on a phone (or with a mouse and keys), offline once installed. Plain
JavaScript and one 2D canvas: no build step, no images, no audio files.

## Phases, not a final base

The enemy comes in **phases**. A phase is one or more enemy bases somewhere in the mist. Destroy
every building in them that is not a wall or a house, and the phase is cleared; after a short
breath the next begins. Later phases bring more bases, or stronger ones, and often more land: the
border (the Veil, drawn as mist) is pushed outwards and the new ground is generated from the seed
the first time anything looks at it. The map has no edge but the one the phases have reached.

The enemy does not gather. A base has a budget that grows with time and with the phase, spends it
on soldiers from its dens — a garrison, waves that walk to the nearest thing of yours, raids on
workers in the open, the odd scout — and fights in the era you could have reached by now
(`enemyEra` in `js/data.js`), growing stronger the longer you linger in one. Every base carves a
track towards your hall when it appears, through wood, rock and shallows, so it can always be
reached on foot and every wave has a road to come down.

## Ten eras

Ember, Bronze, Iron, Crowns, Powder, Steam, Engines, Signal, Stars, Aether. The next era is
researched at the hall once the hall has been raised as far as this era allows and enough phases
are cleared (1, 3, 5, 8, 11, 14, 18, 22, 27). Then it has to be paid for.

- **Buildings have levels, and a building's level is the era it is drawn in**: a level-1 hall is a
  ring of huts round a fire; at level 5 it is a citadel of the Age of Powder; at 10, something
  else. Each level is tougher, trains faster, sees further, widens a border, adds supply, hits
  harder (towers). No building goes past your era.
- **Units are lines, retrained**: workers, foot soldiers, shooters, menders, mounts (which become
  armour), siege, ships and aircraft each have one version per era — Clubber, Spearman, Legionary,
  Man-at-Arms, Grenadier, Trooper, Assault Infantry, Exo-Trooper, Plasma Lancer, Aether Blade — and
  the building that trains a line retrains it, turning every one you already have into the next.
- **Research**: twenty levels of weapons, armour and fortification at the forge, mount, siege,
  naval and air upgrades at their own buildings, felling, prospecting, quarrying and haulage,
  masonry and optics.

The pacing target is about fourteen hours to have everything at its last level and the Beacon lit;
`node tools/validate.js` prints what maxing everything costs, so a change to the numbers shows.

## Champions you can drive

Five champions are called at the altar — the Warden, the Huntress, the Sage, the Shade, the
Artificer — each with four skills (the fourth opens at level 6). They learn from every fight near
them and keep up with your era by themselves; a fallen one can be revived.

In **auto** a champion takes orders like any unit and decides for itself when each skill is worth
casting. Double-tap its portrait (or press Take control) and it is in your hands the way a champion
is in a MOBA: a stick on the left walks, the big button attacks the nearest foe, a skill tapped
casts at the obvious target and a skill dragged is aimed — let go to cast, drag back to cancel.
With a keyboard: WASD, Q W E R toward the pointer, right-click to move or attack. Any ordinary
unit can be taken in hand the same way.

## A realm too big to click

- **Fog of war**: unexplored, explored (ground and enemy buildings as last seen — a tower destroyed
  in the dark stays on your map until you look again) and in sight.
- **Contacts**: every enemy you have seen joins a contact with a position, a heading and a size,
  which stays on the map and the minimap after it leaves sight. Radar adds the ones it can hear
  but nobody can see. **Alarms** mark anything of yours that is struck; Space or the alarm button
  goes there.
- **Doctrines** are researched habits, each with a switch in the Automation panel: Foremen (idle
  workers find work), Pathfinders (a scout stance), Quartermasters (houses before supply runs out),
  Signal Fires (idle soldiers answer alarms, and go back), Wardens of Stone (repairs), Stewards
  (how workers split between resources), Census (keep training workers to a number), Watchmen
  (where a contact is heading), Bureaucracy (a research plan the buildings work through), Logistics
  (a muster point for new soldiers), High Command (strike the nearest known base when the army is
  big enough), Satellites, Drone Wing, Overmind and Continuum.
- **Outposts** claim new ground anywhere you have explored: a border, a drop-off for everything,
  workers, eyes.

## Second pass: running a large realm

- **The Ledger** (the list button at the top): every structure by kind with its levels and health —
  select them all, raise every one that can be raised, send workers to repair the damaged — every
  unit line with its ranks and its idle, the squads, and the economy: what each worker is doing,
  income a minute for the last hour per resource (one small chart each, last value labelled, a
  figure under the pointer for every minute), and what the realm is waiting to afford. It and
  Intel and Automation leave the game running; only the menu pauses it.
- **Details** (the (i) on the selection panel): a building's numbers now and at its next level,
  everything it trains and researches, and the strip of what it looks like in each era; a unit's
  numbers and its next version's, rank and kills; a champion's four skills.
- **Squads** (Make a squad on the command card): a standing job for a group — defend a place,
  patrol the round of halls, outposts and towers, strike the nearest known base when at strength
  (and fall back to regroup when hurt), hunt contacts that come near, or escort the far drop-off
  where most workers are. `js/squads.js`.
- **More doctrines**: Captains (new soldiers fill squads), Masons (rebuild what was destroyed where
  it stood), Sentinels (a tower where the alarms keep ringing), Colonists (outposts beside far
  veins), Standing Army (keep the army at a size and mix), Rebirth (fallen champions called back),
  Stewards that follow demand, and Wake me (pause when a big contact nears home).
- **The wild**: far ruins are guarded by beasts that change with the ages, and a ruin gives nothing
  while they live. **Veterans**: kills earn ranks (Blooded, Veteran, Elite, Legend), each a tenth
  stronger, shown as chevrons.
- **Groups march together** at the pace of their slowest; a base made only of siege dens no
  longer fields nothing but catapults, and siege is softer against soldiers than against walls.
- **Light**: shadows are cast every frame from where the sun is — long and leaning west in the
  morning, short at noon, east in the evening, faint at night — as one path filled once, so
  overlapping shadows do not stack darker. Dawn and dusk wash the frame gold; windows light at
  night, firelight flickering until the lamps come. The ground has a gentle relief.
- **Motion**: bodies fall the way they faced and fade, blows lean into the target, soldiers at rest
  breathe, mounts and engines kick up dust, arrows and stones fly in an arc with a short trail,
  every shot is drawn between ticks instead of jumping, selection rings turn, and a thread runs
  from each selected unit to what it is fighting. With a mouse, whatever is under the pointer
  says what it is.

## The lore

Nothing is told outright. Ruins scattered across the map give up a fragment when a unit walks in,
each era opens with a line, each phase turns with one, and the Codex keeps them in the order you
found them. The enemy builds what you build, in its own colours, with ashen faces and a light where
the eyes are; nothing says why.

## Touch

| Gesture | What it does |
|---------|--------------|
| Tap | Select something of yours; with units selected, the obvious order on whatever was tapped |
| Drag one finger | Look around |
| Pinch | Zoom |
| Press and hold, then drag | A selection box |
| Press and hold, let go | Attack-move there |
| Double-tap a unit | Every one of its kind on screen |
| The strip on the left | Champions (double-tap to drive), groups (hold to save), idle workers, the army, box mode |

**Force landscape** (Settings, on by default on phones) is lifted from Hacks (`js/orient.js`):
where the browser allows it the screen is locked sideways; where it does not, the whole game is
turned a quarter turn and every touch goes through `toApp()`.

## Files

| File | What it is |
|------|------------|
| [`js/data.js`](js/data.js) | Every number: eras, unit lines, buildings, research, doctrines, champions, enemy pressure |
| [`js/lore.js`](js/lore.js) | The fragments, and nothing that explains them |
| [`js/rng.js`](js/rng.js) | Seeded randomness and noise |
| [`js/world.js`](js/world.js) | The infinite map, made a chunk at a time, inside a border that only grows |
| [`js/path.js`](js/path.js) | A* in a window that travels with the search, string-pulled |
| [`js/fog.js`](js/fog.js) | Seen, explored, remembered |
| [`js/entities.js`](js/entities.js) | Making, measuring, hurting and removing things; the spatial grid |
| [`js/units.js`](js/units.js) | Orders: move, attack-move, gather, build, repair, patrol, hold, guard, scout |
| [`js/buildings.js`](js/buildings.js) | Placement and borders, queues, research, levels, eras, towers |
| [`js/combat.js`](js/combat.js) | Homing, lobbed and straight-line shots |
| [`js/heroes.js`](js/heroes.js) | Champions: skills, their judgement, and manual control |
| [`js/enemy.js`](js/enemy.js) | Phases and bases |
| [`js/auto.js`](js/auto.js) | Contacts, alarms and the doctrines |
| [`js/squads.js`](js/squads.js) | Squads: groups with a standing job |
| [`js/ledger.js`](js/ledger.js) | The Ledger: structures, forces, squads, economy |
| [`js/details.js`](js/details.js) | The details sheet for whatever is selected |
| [`js/sim.js`](js/sim.js) | One tick, and a new game |
| [`js/save.js`](js/save.js) | Settings in localStorage, games in IndexedDB; only what changed is saved |
| [`js/terrain.js`](js/terrain.js) | The ground, painted per pixel from blended material fields |
| [`js/sprites.js`](js/sprites.js) | Every unit, building and node, drawn with paths for every era |
| [`js/render.js`](js/render.js) | The frame: water, ground, things, night, fog, the Veil, overlays |
| [`js/fx.js`](js/fx.js) | Sparks, smoke, blasts, tracers, weather |
| [`js/minimap.js`](js/minimap.js) | The realm, small |
| [`js/input.js`](js/input.js) | Touch, mouse and keys into orders; the champion's stick |
| [`js/ui.js`](js/ui.js) | The HUD, the command card, the panels, the title |
| [`js/audio.js`](js/audio.js) | Synthesised sounds and generative music |
| [`js/orient.js`](js/orient.js) | Force landscape, lifted from Hacks |
| [`js/update.js`](js/update.js) | Noticing a new version, lifted from Hacks |
| [`js/info.js`](js/info.js) | The (i) sheet, lifted from Hacks |
| [`tools/validate.js`](tools/validate.js) | `node tools/validate.js` — static checks and whole games played headless |
| [`tools/e2e.js`](tools/e2e.js) | `node tools/e2e.js` — the game played in Chromium, on a phone both ways up and a computer |

## Updates

The house pattern (see the repository's `CLAUDE.md`): `sw.js` never takes over by itself, answers
`"skip-waiting"`, and carries `window.AE_VERSION` as its cache name; the page checks on load,
every half hour, when it comes back and when the network does, and offers a reload in one bar. A
realm in progress is saved before the reload. Bumping `AE_VERSION` (and the cache name with it —
the validator refuses to let them drift) is what publishes an update.

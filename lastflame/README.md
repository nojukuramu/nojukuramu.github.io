# Last Flame — a horror night in Lola's house

A typhoon, a brownout, and Lola's bahay na bato with every lamp gone out. Carry a lantern that is
running dry through the dark upper floor, relight the five oil lamps, and hide when the thing in
the house comes looking. Then, at the fifth lamp, the light turns against you: get to the front
door in the dark.

First person, in 3D with Three.js. Plain ES modules, no build step, no accounts, nothing sent
anywhere. Plays offline once installed, with a mouse and keyboard, a gamepad, or a phone held
sideways.

## Running it

Serve the folder (`npx http-server lastflame` or any static server) and open it.

| Check | Command |
|-------|---------|
| Static and behaviour checks (98) | `node tools/validate.js` |
| The game in a real browser, WebGL included (29) | `node tools/e2e.js [--shots dir]` |

`validate.js` builds 250 houses and walks every one, then lets an autopilot play two dozen whole
nights and prints how it did — it gets out of most of them, and dies four or five times a night
doing it.

## The research, and what came of it

The game is built from one research note on what makes simple horror work (the proposal in it is
even called *Last Flame*). Its findings, and where each ended up:

| The research says | In Last Flame |
|-------------------|---------------|
| A plain goal, no combat, one scarce resource | Five lamps and a door. You cannot fight. The lantern's oil burns, faster when you run, and a lamp gives some back once. |
| Fear is the threat's position and timing, not its damage | One hunter, mostly heard. Caught is caught, every time; what changes is how often, how near and how informed it is. |
| Light is a trade: it shows the way and shows you | A lit lantern is seen from 18 m; with the wick down it has to be within about 3.5. The dark has its own cost: dread, which you breathe out loud. |
| Running is loud, crouching is quiet; it goes to what it hears | Sound is measured along the floor, through doorways — a shut door adds metres. Some floorboards creak whatever you do; pots on the floor get kicked. |
| Closets hide you if it did not see you get in | And if it did, it tears the doors open. Inside, hold your breath when it is close — for as long as you can. |
| One stress number, a Relax timer, a nudge, a d20 | The director: stress from nearness, sight and chases; past the peak it sends the hunter away for 45, 38, 30 s as the night goes on; a nudge toward your part of the house from the third lamp; a d20 against the threat level for which room it tries next. Never your exact spot; it never teleports. |
| Threat = lamps lit + a little time | Exactly that, 0–20. It keys off progress, never off your deaths. |
| Onboarding in a minute, through systems | Start a few steps from the first lamp; the hint is one line. Then a flicker, a window banging open, footsteps, a closet two strides away — and it walks past. |
| One honest tell | Every footstep it takes plays from where it is. The tiktik call is honest too, the way the stories tell it: loud when it is far, faint when it is near. |
| Vague feedback, no meters | No HUD. Dread narrows the picture, drains the colour, makes it breathe and dulls the sound. Oil is words when you lift the lantern. |
| Spiky, not flat; a breather before the peak | Calm, unease, pressure, dread — then the fifth lamp, and forty seconds of near silence while the rain dies and the clock strikes. |
| Simple games go stale in the back half: change a rule | The inversion. The lit lamps become its route, your lantern is a beacon it always knows, a doorway on the way back is boarded up, another wall is broken through, the chairs have turned to face you. Cross it dark, by sound, toward the front door creaking in the wind. |
| Short restarts, randomised layouts | Lola's Rules: you wake by the last lamp you lit, three seconds later. One Night: caught ends it, and the next night is a new house. Every night's house is new either way. |
| Show the monster rarely | It is lit by nothing of its own: a shape, and eyeshine when your light catches it. |
| Fear-tolerance options | How afraid (Gentle, Normal, Merciless: sight, notice, chase speed and Relax length), Reduced jump scares, head bob and shake off, sound captions with directions. |

## How it is built

| File | What it is |
|------|------------|
| [`js/house.js`](js/house.js) | the house, from a seed: a 6 × 5 grid of 4 m cells partitioned into rooms (caida, sala, comedor, cocina, banyo, oratorio, cuartos…), a random spanning tree of doorways plus loops, capiz windows, furniture placed by each room's recipe against the walls, the lamps, closets, tins, notes and creaking boards — and the change at the fifth lamp |
| [`js/nav.js`](js/nav.js) | the house as a quarter-metre grid: A* for the hunter, line of sight, sound distance along the floor, and the player's sliding collision |
| [`js/hunter.js`](js/hunter.js) | the hunter: patrol, investigate, chase, retreat, stare, rip; what it sees and hears |
| [`js/game.js`](js/game.js) | the rules and the director; pure, so the validator plays whole nights in Node |
| [`js/render.js`](js/render.js) | the house in 3D: walls with wainscot and the calado band, beamed ceilings, doors, louvred closets, capiz, furniture, the lantern's shadows, the lamps, lightning, and the post pass that carries dread |
| [`js/creature.js`](js/creature.js) | the aswang, built and posed in code: two-bone limbs, a dress, curtains of hair that swing late, a face no one should see twice |
| [`js/textures.js`](js/textures.js) | everything drawn rather than downloaded: capiz shells, calado fretwork, paper, the face, skin, hair, cloth, flame |
| [`js/audio.js`](js/audio.js) | HRTF sound from where things are, muffled through walls; the rain, storm, frogs, drone and heartbeat beds; the tiktik |
| [`js/input.js`](js/input.js) | keyboard and mouse (pointer lock), touch (a stick that appears under the thumb, buttons under the other), gamepad |
| [`js/ui.js`](js/ui.js), [`js/topics.js`](js/topics.js) | the screens, the one-line hints and prompts, and every long explanation behind an (i) |
| [`js/main.js`](js/main.js) | the loop, nights starting and ending, the title scene, the service worker |
| `js/update.js`, `js/info.js`, `js/icons.js`, `js/rng.js`, `js/save.js`, `sw.js`, `vendor/` | lifted from Ballzooka — see below |

**The house is always walkable.** Furniture against three walls of a room can still cut a doorway
off; the generator checks that every doorway, lamp, closet and the front door sit on one piece of
floor, and takes away whatever stands nearest a cut-off spot until they do. The change at the
fifth lamp boards up a doorway only if that still holds — the validator checks both, for hundreds
of houses.

**Light and the lamps.** A relit lamp's light is a pool the hunter will not enter while the house
is still partly dark (its paths treat the pool as solid, and lighting a lamp on top of it makes it
shriek and back away). That is what makes lighting one a relief — and what the fifth lamp takes
away.

**Assets.** Furniture and surfaces are [Poly Haven](https://polyhaven.com) (CC0), packed small with
glTF-Transform — see [`assets/models/CREDITS.md`](assets/models/CREDITS.md) and
[`assets/textures/CREDITS.md`](assets/textures/CREDITS.md). Recordings are CC0 or public domain
(BigSoundBank, Kenney, OpenGameArt contributors, radio aporee, Wikimedia Commons), cut and credited
in [`assets/sounds/CREDITS.md`](assets/sounds/CREDITS.md); the night outside is a field of frogs in
Biñan, Laguna. Everything plays its own synthesised stand-in until its file has loaded.

**Reused, not rewritten** (CLAUDE.md). `update.js`, `info.js`, `sw.js` and `save.js`'s shape are
Ballzooka's — which are Bloomworks', Aeons', Hacks' and RouteCast's — with the version name and the
reload question changed. `rng.js` is Ballzooka's whole. `icons.js` keeps Ballzooka's shape and
general glyphs. `render.js` keeps its renderer setup (the vendored three r160, ACES, the
UnrealBloomPass, a quality switch); `vendor/` is Ballzooka's three with Hacks' GLTFLoader.
`creature.js` uses Hacks' two-bone IK (`hacks/js/skeleton.js`) for every elbow and knee.

**Auto-update.** The house pattern: the worker never calls `skipWaiting()` on install, answers
`"skip-waiting"` when the page asks, and the page checks on load, every 30 minutes, on return from
hidden and when the network comes back. A bar offers the reload; Settings shows the version and a
"Check for updates" button; a night in progress is confirmed before reloading.
`window.LF_VERSION` in `index.html` and the worker's `lastflame-v<N>` cache name are one number,
and the validator refuses to let them drift — bumping it is what publishes an update.

**Privacy.** Settings and a record of past nights are in localStorage and nowhere else. No network
requests beyond the game's own files.
